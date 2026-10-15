#![allow(non_snake_case)]

//! Arc GX — captura de janela via Windows Graphics Capture (N-API).
//!
//! Pipeline:
//!
//! ```text
//!   HWND
//!    -> GraphicsCaptureItem.TryCreateFromWindowId
//!    -> Direct3D11CaptureFramePool.CreateFreeThreaded (2 frames, BGRA)
//!    -> pool.CreateCaptureSession
//!    -> pool.FrameArrived  -> Direct3DSurface
//!    -> IDirect3DDxgiInterfaceAccess.GetInterface<ID3D11Texture2D>
//!    -> CopyResource para a staging -> Map()
//!    -> slot compartilhado -> pollFrame() pelo JS
//! ```
//!
//! Por que nao `desktopCapturer` do Electron: ele devolve o frame da tela
//! composta (o proprio overlay apareceria na captura) e da preto em fullscreen
//! exclusivo. `GraphicsCaptureItem` da acesso ao frame da janela antes da
//! composicao.
//!
//! ## Modelo de entrega
//!
//! O frame NAO chega por callback. O addon guarda o ultimo frame e o JS chama
//! `pollFrame()` quando quiser. Um `ThreadsafeFunction` custaria ~120 MB/s de
//! copia a 15 Hz e ainda assim nao evitaria o scan worker precisar ler.
//!
//! ## Memoria de video
//!
//! O frame pool segura VRAM enquanto vive. `stopCapture` fecha a sessao e
//! derruba pool, device e staging — se o pool nao for destruido, o driver
//! continua segurando centenas de MB mesmo com a janela fechada.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::Uint8Array;
use napi::{Error, Result};
use napi_derive::napi;
use windows::core::{Interface, Ref};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::Direct3D11CaptureFramePool;
use windows::core::factory;
use windows::Graphics::Capture::{GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::{IDirect3DDevice, IDirect3DSurface};
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{
    CO_E_NOTINITIALIZED, HMODULE, HWND, RECT, RPC_E_CHANGED_MODE,
};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP, D3D_FEATURE_LEVEL,
    D3D_FEATURE_LEVEL_10_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_11_0,
    D3D_FEATURE_LEVEL_11_1,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_FLAG, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::{Common::DXGI_FORMAT_B8G8R8A8_UNORM, IDXGIDevice};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetForegroundWindow, GetWindowRect, GetWindowTextW, IsWindow, IsWindowVisible,
    SetForegroundWindow, ShowWindow, SW_RESTORE,
};

/// bytes por pixel do formato B8G8R8A8
const BYTES_PER_PIXEL: usize = 4;

/* ============================================================ tipos N-API */

#[napi(object)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[napi(object)]
pub struct Support {
    pub windows_graphics_capture: bool,
    pub d3d11: bool,
    pub reason: Option<String>,
}

#[napi(object)]
pub struct FrameInfo {
    pub width: u32,
    pub height: u32,
    /// bytes por pixel (BGRA = 4)
    pub stride: u32,
    /// copia do frame — snapshot, nao uma visao da GPU
    pub data: Uint8Array,
    /// ms desde epoch
    pub timestamp: f64,
    pub source: String,
    pub hwnd: Option<i64>,
}

#[napi(object)]
pub struct Stats {
    pub frames: i64,
    pub dropped: i64,
    pub last_width: u32,
    pub last_height: u32,
    pub last_error: Option<String>,
    pub fps: f64,
    /// MB de VRAM aprovados no frame pool (2 buffers + staging)
    pub vram_mb: f64,
}

#[napi(object)]
pub struct WindowInfo {
    pub hwnd: i64,
    pub title: String,
    pub rect: Option<Rect>,
    /// PID dono da janela. Sem ele nao da para distinguir a janela do jogo de
    /// janelas auxiliares do sistema que passam por `IsWindowVisible` — como
    /// "Microsoft Text Input Application", que ocupa a tela inteira e nunca
    /// produz frame.
    pub pid: u32,
}

/* ============================================================== estado */

struct Frame {
    width: u32,
    height: u32,
    bytes: Vec<u8>,
    timestamp: f64,
}

/// WinRT e D3D11 sao livres de bloqueio (agile), mas o compilador nao sabe.
/// O handler de `FrameArrived` roda na thread do pool e precisa alcancar os
/// mesmos objetos que o main thread criou.
struct Sendable<T>(T);
unsafe impl<T> Send for Sendable<T> {}
unsafe impl<T> Sync for Sendable<T> {}

struct Capture {
    device: IDirect3DDevice,
    d3d: ID3D11Device,
    /// O immediate context nao e thread-safe; so `process_frame` o toca, e
    /// sempre na thread do WGC.
    context: Sendable<ID3D11DeviceContext>,
    staging: Sendable<ID3D11Texture2D>,
    staging_size: (u32, u32),
    session: Sendable<GraphicsCaptureSession>,
    _pool: Sendable<Direct3D11CaptureFramePool>,
    _handler: Sendable<TypedEventHandler<Direct3D11CaptureFramePool, windows::core::IInspectable>>,
    frame_token: i64,
    hwnd: i64,
}

struct Shared {
    slot: Mutex<Option<Frame>>,
    capture: Mutex<Option<Capture>>,
    running: AtomicBool,
    frames: AtomicU64,
    dropped: AtomicU64,
    last_w: AtomicU64,
    last_h: AtomicU64,
    fps: Mutex<(u64, f64)>,
    last_error: Mutex<Option<String>>,
}

static STATE: Mutex<Option<Arc<Sendable<Shared>>>> = Mutex::new(None);

fn shared() -> Arc<Sendable<Shared>> {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(Arc::new(Sendable(Shared {
            slot: Mutex::new(None),
            capture: Mutex::new(None),
            running: AtomicBool::new(false),
            frames: AtomicU64::new(0),
            dropped: AtomicU64::new(0),
            last_w: AtomicU64::new(0),
            last_h: AtomicU64::new(0),
            fps: Mutex::new((0, 0.0)),
            last_error: Mutex::new(None),
        })));
    }
    guard.as_ref().unwrap().clone()
}

fn set_error(s: &Shared, msg: impl Into<String>) {
    *s.last_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(msg.into());
}

/* ============================================== criacao do device D3D11 */

/// Rotula uma etapa do `startCapture`.
///
/// Sem isso, qualquer falha no caminho de captura chega como um HRESULT cru e
/// a mensagem nao diz se foi o device, o item, o pool ou a sessao — e foi
/// exatamente essa falta que deixou um E_NOINTERFACE de API errada parecer
/// "WGC indisponivel nesta maquina".
fn step<T>(what: &str, r: windows::core::Result<T>) -> windows::core::Result<T> {
    match r {
        Ok(v) => {
            *DIAG.lock().unwrap_or_else(|x| x.into_inner()) = format!("ok em {}", what);
            Ok(v)
        }
        Err(e) => {
            *DIAG.lock().unwrap_or_else(|x| x.into_inner()) =
                format!("falhou em {}: {}", what, e);
            Err(e)
        }
    }
}

/// Prepara a thread para WinRT. Feito uma vez, de forma idempotente.
/// Sem isso, `CreateDirect3D11DeviceFromDXGIDevice` — e a obtencao do
/// `GraphicsCaptureItem` — falham nathread que o Node usa: o runtime nao
/// chama `RoInitialize`, e ativar uma fabrica WinRT em thread nao
/// inicializada devolve `CO_E_NOTINITIALIZED` (0x800401F0).
///
/// O sintoma aparece embrulhado: `create_d3d_device` converte qualquer falha
/// em `E_FAIL`, e o addon reportava "D3D11 indisponivel: Erro nao especificado
/// (0x80004005)" — que e o erro de WinRT mascarado, nao o de D3D11.
///
/// `RPC_E_CHANGED_MODE` significa que a thread ja e STA. WinRT funciona em
/// STA, entao isso nao e erro.
fn ensure_winrt() -> windows::core::Result<()> {
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        Ok(()) => Ok(()),
        Err(e) if e.code() == RPC_E_CHANGED_MODE => Ok(()),
        Err(e) if e.code() == CO_E_NOTINITIALIZED => Err(e),
        Err(_) => Ok(()),
    }
}

/// Cria o device D3D11 + o `IDirect3DDevice` que o WGC exige.
///
/// Nao ha um unico caminho valido: a GPU pode nao suportar 11_1, e em maquina
/// sem driver utilizavel so ha WARP (render por software). A escada abaixo
/// tenta do melhor para o pior e devolve o erro real se tudo falhar — importa
/// porque "WGC indisponivel" sem motivo e impossible de diagnosticar.
fn create_d3d_device() -> windows::core::Result<(IDirect3DDevice, ID3D11Device, ID3D11DeviceContext)> {
    const LEVELS: &[D3D_FEATURE_LEVEL] = &[
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_1,
        D3D_FEATURE_LEVEL_10_0,
    ];

    let mut attempts: Vec<String> = Vec::new();

    if let Err(e) = ensure_winrt() {
        attempts.push(format!("RoInitialize=0x{:08X}", e.code().0 as u32));
        *DIAG.lock().unwrap_or_else(|x| x.into_inner()) = attempts.join(" ");
        return Err(e);
    }

    let drivers = [D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP];
    for driver in drivers {
        for level in LEVELS {
            match device_types_for(driver, *level) {
                Ok(triple) => {
                    *DIAG.lock().unwrap_or_else(|x| x.into_inner()) =
                        format!("ok em {:?}/{:?}", driver, level);
                    return Ok(triple);
                }
                Err(e) => attempts.push(format!("{:?}/{:?}=0x{:08X}", driver, level, e.code().0 as u32)),
            }
        }
    }

    let msg = format!("D3D11 falhou em todas as combinacoes: {}", attempts.join(" "));
    *DIAG.lock().unwrap_or_else(|e| e.into_inner()) = msg;
    Err(windows::core::Error::from(windows::Win32::Foundation::E_FAIL))
}

/// Detalhe da ultima falha de D3D11 — diagnostico, nao estado.
static DIAG: Mutex<String> = Mutex::new(String::new());

#[napi]
pub fn last_d3d_error() -> String {
    DIAG.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn device_types_for(
    driver: D3D_DRIVER_TYPE,
    level: D3D_FEATURE_LEVEL,
) -> windows::core::Result<(IDirect3DDevice, ID3D11Device, ID3D11DeviceContext)> {
    unsafe {
        let mut d3d: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;

        D3D11CreateDevice(
            None,
            driver,
            HMODULE(std::ptr::null_mut()),
            D3D11_CREATE_DEVICE_FLAG(0),
            Some(&[level]),
            // A binding deriva a CONTAGEM de levels do proprio slice. O
            // parametro seguinte e SDKVersion, e a D3D11 o valida: com 0 em vez
            // de D3D11_SDK_VERSION ela recusa a chamada com E_INVALIDARG — em
            // todas as combinacoes de driver e feature level, o que faz o
            // sintoma parecer "D3D11 indisponivel nesta maquina" quando nao e.
            D3D11_SDK_VERSION,
            Some(&mut d3d),
            None,
            Some(&mut context),
        )?;

        let d3d = d3d.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
        let context =
            context.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;

        // O DXGI vem do device: e por ele que o WGC recebe o IDirect3DDevice
        let dxgi: IDXGIDevice = d3d.cast()?;
        let raw = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?;
        let device: IDirect3DDevice = raw.cast()?;
        Ok((device, d3d, context))
    }
}

fn create_staging_texture(
    d3d: &ID3D11Device,
    width: u32,
    height: u32,
) -> windows::core::Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };

    unsafe {
        let mut texture: Option<ID3D11Texture2D> = None;
        d3d.CreateTexture2D(&desc, None, Some(&mut texture))?;
        texture.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))
    }
}

/* ============================================================== suporte */

#[napi]
pub fn capture_support() -> Support {
    if !cfg!(windows) {
        return Support {
            windows_graphics_capture: false,
            d3d11: false,
            reason: Some("Windows Graphics Capture so existe no Windows".into()),
        };
    }
    match create_d3d_device() {
        Ok(_) => Support {
            windows_graphics_capture: true,
            d3d11: true,
            reason: None,
        },
        Err(e) => Support {
            windows_graphics_capture: false,
            d3d11: false,
            reason: Some(format!("D3D11 indisponivel: {e}")),
        },
    }
}

/* ========================================================= inicio / fim */

#[napi]
pub fn start_capture(hwnd: i64) -> Result<()> {
    if hwnd <= 0 {
        return Err(Error::from_reason("hwnd invalido"));
    }
    let s = shared();

    let h = HWND(hwnd as *mut std::ffi::c_void);
    unsafe {
        if !IsWindow(Some(h)).as_bool() {
            let msg = "janela nao existe mais";
            set_error(&s.0, msg);
            return Err(Error::from_reason(msg));
        }
        if !IsWindowVisible(h).as_bool() {
            let msg = "janela esta minimizada ou oculta (WGC exige janela visivel)";
            set_error(&s.0, msg);
            return Err(Error::from_reason(msg));
        }
    }

    if s.0.running.load(Ordering::Acquire) {
        stop_capture_inner(&s);
    }

    start_capture_inner(&s, hwnd).map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn stop_capture() {
    stop_capture_inner(&shared());
}

fn stop_capture_inner(s: &Arc<Sendable<Shared>>) {
    s.0.running.store(false, Ordering::Release);

    let taken = s.0.capture.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(mut cap) = taken {
        // soltar a inscricao do evento antes de derrubar o pool
        let _ = unsafe { cap._pool.0.RemoveFrameArrived(cap.frame_token) };
        let _ = cap.session.0.Close();
    }

    *s.0.slot.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *s.0.last_error.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn start_capture_inner(s: &Arc<Sendable<Shared>>, hwnd: i64) -> windows::core::Result<()> {
    *s.0.last_error.lock().unwrap_or_else(|e| e.into_inner()) = None;

    let (device, d3d, context) = step("d3d11 device", create_d3d_device())?;

    // Item de captura pela INTEROP, nao por `TryCreateFromWindowId`.
    //
    // A fabrica `GraphicsCaptureItem::TryCreateFromWindowId(WindowId)` e API do
    // Windows 11 24H2+. No Windows 10 22H2 (build 19045) ela responde
    // E_NOINTERFACE (0x80004002) — e a falha aparece como "WGC indisponivel",
    // parecendo problema de plataforma quando e API incorreta.
    //
    // `IGraphicsCaptureItemInterop::CreateItemForWindow` existe desde o
    // Windows 10 1903 e funciona em todas as versoes suportadas.
    let item = step(
        "item de captura",
        (|| {
            let interop: IGraphicsCaptureItemInterop =
                factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
            unsafe {
                interop.CreateForWindow::<GraphicsCaptureItem>(HWND(hwnd as *mut core::ffi::c_void))
            }
        })(),
    )?;

    let size = step("tamanho do item", item.Size())?;
    if size.Width <= 0 || size.Height <= 0 {
        return Err(windows::core::Error::from(windows::Win32::Foundation::E_FAIL));
    }

    let pool = step(
        "frame pool",
        Direct3D11CaptureFramePool::CreateFreeThreaded(
            &device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        ),
    )?;

    let session = step("sessao de captura", pool.CreateCaptureSession(&item))?;
    let _ = session.StartCapture();

    let staging = step(
        "textura de staging",
        create_staging_texture(&d3d, size.Width as u32, size.Height as u32),
    )?;

    // O handler precisa sobreviver alem deste scope: quando o
    // TypedEventHandler e descartado, o runtime remove a inscricao e a captura
    // morre sozinha.
    let weak = Arc::downgrade(s);
    let handler = TypedEventHandler::new(
        move |_sender: Ref<'_, Direct3D11CaptureFramePool>,
              _args: Ref<'_, windows::core::IInspectable>| {
            let Some(shared) = weak.upgrade() else { return Ok(()) };
            if let Err(e) = process_frame(&shared.0) {
                shared.0.dropped.fetch_add(1, Ordering::Relaxed);
                *shared
                    .0
                    .last_error
                    .lock()
                    .unwrap_or_else(|x| x.into_inner()) = Some(e.to_string());
            }
            Ok(())
        },
    );

    let frame_token = unsafe { pool.FrameArrived(&handler)? };

    *s.0.capture.lock().unwrap_or_else(|e| e.into_inner()) = Some(Capture {
        device,
        d3d,
        context: Sendable(context),
        staging: Sendable(staging),
        staging_size: (size.Width as u32, size.Height as u32),
        session: Sendable(session),
        _pool: Sendable(pool),
        _handler: Sendable(handler),
        frame_token,
        hwnd,
    });

    s.0.running.store(true, Ordering::Release);
    Ok(())
}

/* ================================================== processamento do frame */

/// Pega o proximo frame disponivel do pool e publica no slot.
///
/// `TryGetNextFrame` e non-bloqueante: se nao ha frame pronto, devolve erro e
/// o chamador simplesmente tenta de novo no proximo `FrameArrived`.
fn process_frame(s: &Shared) -> windows::core::Result<()> {
    let mut slot_guard = s.capture.lock().unwrap_or_else(|e| e.into_inner());
    let cap = slot_guard
        .as_mut()
        .ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_ABORT))?;

    let frame = cap
        ._pool
        .0
        .TryGetNextFrame()
        .map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;

    let content = frame.ContentSize()?;
    if content.Width <= 0 || content.Height <= 0 {
        return Err(windows::core::Error::from(windows::Win32::Foundation::E_FAIL));
    }

    let (w, h) = (content.Width as u32, content.Height as u32);
    let total = (w as usize * BYTES_PER_PIXEL) * h as usize;

    // a janela pode ter sido redimensionada
    if cap.staging_size != (w, h) {
        cap.staging = Sendable(create_staging_texture(&cap.d3d, w, h)?);
        cap.staging_size = (w, h);
    }

    let surface: IDirect3DSurface = frame.Surface()?;
    let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
    let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };

    // CopyResource/Map/Unmap vivem no immediate context, nao no device
    let dst: ID3D11Resource = cap.staging.0.cast()?;
    let src: ID3D11Resource = texture.cast()?;

    let snapshot = unsafe {
        cap.context.0.CopyResource(&dst, &src);

        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        cap.context.0.Map(&dst, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;

        let bytes = std::slice::from_raw_parts(mapped.pData as *const u8, total);
        let copy = bytes.to_vec();

        cap.context.0.Unmap(&dst, 0);
        copy
    };

    drop(slot_guard);

    *s.slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(Frame {
        width: w,
        height: h,
        bytes: snapshot,
        timestamp: now_ms(),
    });

    s.frames.fetch_add(1, Ordering::Relaxed);
    s.last_w.store(w as u64, Ordering::Relaxed);
    s.last_h.store(h as u64, Ordering::Relaxed);

    let mut guard = s.fps.lock().unwrap_or_else(|e| e.into_inner());
    let now = now_ms();
    if guard.0 == 0 {
        guard.0 = now as u64;
        guard.1 = 0.0;
    } else if now - guard.0 as f64 >= 1000.0 {
        guard.1 = s.frames.load(Ordering::Relaxed) as f64 / ((now - guard.0 as f64) / 1000.0);
        guard.0 = now as u64;
    }

    Ok(())
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/* ============================================================== leitura */

/// Le e consome o frame mais recente.
///
/// A copia e inevitavel (o JS nao pode guardar ponteiro para memoria da GPU),
/// mas so acontece quando o scan worker realmente vai usar o frame.
#[napi]
pub fn poll_frame() -> Option<FrameInfo> {
    let s = shared();

    // tira do slot antes de copiar: segurar o lock durante 8 MB travaria o
    // thread do WGC que esta gravando
    let frame = s.0.slot.lock().unwrap_or_else(|e| e.into_inner()).take()?;

    let hwnd = s.0.capture.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|c| c.hwnd);

    Some(FrameInfo {
        width: frame.width,
        height: frame.height,
        stride: BYTES_PER_PIXEL as u32,
        data: Uint8Array::new(frame.bytes),
        timestamp: frame.timestamp,
        source: "window".to_string(),
        hwnd,
    })
}

#[napi]
pub fn stats() -> Stats {
    let sh = shared();
    let fps = sh.0.fps.lock().unwrap_or_else(|e| e.into_inner()).1;
    let w = sh.0.last_w.load(Ordering::Relaxed);
    let h = sh.0.last_h.load(Ordering::Relaxed);
    let last_error = sh.0.last_error.lock().unwrap_or_else(|e| e.into_inner()).clone();
    // 2 buffers do pool + 1 staging
    let vram = (w * h * 4 * 3) as f64 / (1024.0 * 1024.0);

    Stats {
        frames: sh.0.frames.load(Ordering::Relaxed) as i64,
        dropped: sh.0.dropped.load(Ordering::Relaxed) as i64,
        last_width: w as u32,
        last_height: h as u32,
        last_error,
        fps: (fps * 10.0).round() / 10.0,
        vram_mb: (vram * 10.0).round() / 10.0,
    }
}

#[napi]
pub fn is_running() -> bool {
    shared().0.running.load(Ordering::Acquire)
}

/* ============================================================== janelas */

fn hwnd(value: i64) -> HWND {
    HWND(value as *mut std::ffi::c_void)
}

#[napi]
pub fn target_window_rect(hwnd_value: i64) -> Option<Rect> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(hwnd(hwnd_value), &mut r).ok()? };
    Some(Rect {
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
    })
}

#[napi]
pub fn target_client_rect(hwnd_value: i64) -> Option<Rect> {
    let mut r = RECT::default();
    unsafe { GetClientRect(hwnd(hwnd_value), &mut r).ok()? };
    Some(Rect {
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
    })
}

#[napi]
pub fn window_title(hwnd_value: i64) -> String {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd(hwnd_value), &mut buf) };
    String::from_utf16_lossy(&buf[..len as usize])
}

#[napi]
pub fn is_window(hwnd_value: i64) -> bool {
    unsafe { IsWindow(Some(hwnd(hwnd_value))).as_bool() }
}

#[napi]
pub fn window_has_foreground(hwnd_value: i64) -> bool {
    unsafe { GetForegroundWindow().0 as i64 == hwnd_value }
}

#[napi]
pub fn is_target_foreground(hwnd_value: i64) -> bool {
    window_has_foreground(hwnd_value)
}

#[napi]
pub fn focus_game_window(hwnd_value: i64) {
    let h = hwnd(hwnd_value);
    unsafe {
        if IsWindow(Some(h)).as_bool() {
            // `SW_RESTORE` em janela maximizada a desmáxima: traz o jogo de volta
            // para o tamanho de janela, o que muda o retangulo, muda o tamanho
            // do frame pool e desalinha a calibracao de ROI. So restaura o que
            // esta mesmo minimizado (x = -32000).
            let mut r = RECT::default();
            let minimized = GetWindowRect(h, &mut r).is_ok() && (r.left <= -32000 || r.top <= -32000);
            if minimized {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            let _ = SetForegroundWindow(h);
        }
    }
}

/// Janelas visiveis com titulo — para o seletor do painel.
#[napi]
pub fn list_windows() -> Vec<WindowInfo> {
    let mut out = Vec::new();
    unsafe {
        let mut current = windows::Win32::UI::WindowsAndMessaging::GetTopWindow(None)
            .ok();

        while let Some(h) = current {
            if IsWindowVisible(h).as_bool() {
                let mut buf = [0u16; 512];
                let len = GetWindowTextW(h, &mut buf);
                if len > 0 {
                    let title = String::from_utf16_lossy(&buf[..len as usize]);
                    let mut r = RECT::default();
                    let rect = GetWindowRect(h, &mut r).ok().map(|_| Rect {
                        x: r.left,
                        y: r.top,
                        width: r.right - r.left,
                        height: r.bottom - r.top,
                    });
                    let mut pid = 0u32;
                    windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(h, Some(&mut pid));
                    out.push(WindowInfo {
                        hwnd: h.0 as i64,
                        title,
                        rect,
                        pid,
                    });
                }
            }
            current = windows::Win32::UI::WindowsAndMessaging::GetWindow(
                h,
                windows::Win32::UI::WindowsAndMessaging::GW_HWNDNEXT,
            )
            .ok();
        }
    }
    out
}