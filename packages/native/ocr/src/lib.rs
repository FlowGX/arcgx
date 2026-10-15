//! OCR por `Windows.Media.Ocr`.
//!
//! ## Por que começar aqui e não pelo PaddleOCR
//!
//! O modelo do PaddleOCR são ~20 MB em ONNX que precisam ser baixados,
//! desembrulhados e configurados. O Windows OCR já está no sistema: é o mesmo
//! mecanismo que o Windows usa no "Pesquisa Visual" e no ditado.
//!
//! A referência também usa os dois, trocando entre eles por `ARC_OCR_ENGINE`.
//! A ordem aqui é a mesma: Windows primeiro porque funciona no primeiro boot,
//! sem download e sem pacote de Recognition além do que o usuário já tem
//! instalado. PaddleOCR entra depois, para os idiomas sem pacote e para os
//! casos em que a caixa por palavra do Windows erra fonte pequena.
//!
//! ## Buffer
//!
//! `Buffer` não tem construtor a partir de bytes em Rust, então o caminho é:
//! `Buffer::Create` aloca, e `IBufferByteAccess` expõe o ponteiro bruto para
//! escrita direta. `SoftwareBitmap::CreateCopyFromBuffer` recebe esse mesmo
//! `IBuffer`, sem cópia adicional.
//!
//! ## Assincronismo
//!
//! `RecognizeAsync` devolve `IAsyncOperation`. Este addon é síncrono, então o
//! `recognize` espera o conclusão com um teto de 1500 ms e devolve erro se
//! estourar — travar o worker seria pior que perder um frame de leitura.

use napi::bindgen_prelude::*;
use napi_derive::napi;

use windows::core::Interface;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{Buffer, DataWriter};

/// Uma palavra reconhecida, com a caixa em pixels do frame.
#[napi(object)]
pub struct OcrWord {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// O Windows não expõe confiança por palavra; 1 quando houve
    /// reconhecimento. Fica no contrato para o dia em que existir.
    pub confidence: f64,
}

#[napi(object)]
pub struct OcrResult {
    pub words: Vec<OcrWord>,
    /// Texto corrido, separado por espaço.
    pub text: String,
    pub ms: f64,
}

#[napi(object)]
pub struct OcrSupport {
    pub available: bool,
    pub reason: Option<String>,
}

/// Diz se o Windows tem motor de OCR pronto, sem precisar reconhecer nada.
///
/// `TryCreateFromUserProfileLanguages` já resolve em STA e devolve erro
/// quando falta pacote de Recognition — é o mesmo caminho que o app usa para
/// avisar antes de o usuário habilitar a opção.
#[napi]
pub fn ocr_support() -> OcrSupport {
    match OcrEngine::TryCreateFromUserProfileLanguages() {
        Ok(_) => OcrSupport {
            available: true,
            reason: None,
        },
        Err(e) => OcrSupport {
            available: false,
            reason: Some(format!(
                "{e} — instale um pacote de recognition optica em Configuracoes > \
                 Tempo e idioma > Idioma e regiao"
            )),
        },
    }
}

/// Diagnóstico do caminho de buffer.
///
/// `CreateCopyFromBuffer` e `LockBuffer` falharam por motivos diferentes e
/// nada no erro original diz qual. Isto reporta o que o WinRT realmente
/// devolve, para não continuar adivinhando.
#[napi]
pub fn diag_buffer(len: u32) -> String {
    let mut out = String::new();
    match Buffer::Create(len) {
        Ok(b) => {
            out += &format!(
                "Buffer::Create({len}) -> Capacity={:?} Length={:?}\n",
                b.Capacity(),
                b.Length()
            );
            let expected = len as usize;
            let filled = if (b.Length().unwrap_or(0) as usize) >= expected {
                "Length ok".to_string()
            } else {
                format!("Length {} < necessario {expected}", b.Length().unwrap_or(0))
            };
            out += &format!("verificacao: {filled}\n");

            // 4x4 minimo: se um buffer minimo tambem falha, o problema nao e
            // tamanho e sim a forma como o buffer foi construido.
            let small = 4 * 4 * 4;
            match Buffer::Create(small) {
                Ok(b2) => match SoftwareBitmap::CreateCopyFromBuffer(
                    &b2,
                    BitmapPixelFormat::Bgra8,
                    4,
                    4,
                ) {
                    Ok(_) => out += "CreateCopyFromBuffer 4x4 -> OK\n",
                    Err(e) => out += &format!("CreateCopyFromBuffer 4x4 -> {e}\n"),
                },
                Err(e) => out += &format!("Buffer::Create(64) falhou: {e}\n"),
            }
        }
        Err(e) => out += &format!("Buffer::Create falhou: {e}\n"),
    }
    out
}

/// Reconhece texto num recorte BGRA sem padding de linha.
#[napi]
pub fn recognize(bgra: Uint8Array, width: u32, height: u32) -> Result<Option<OcrResult>> {
    let t0 = std::time::Instant::now();
    let w = width as i32;
    let h = height as i32;
    if w <= 0 || h <= 0 {
        return Err(Error::from_reason("frame vazio"));
    }
    let expected = (w as usize) * (h as usize) * 4;
    if bgra.len() < expected {
        return Err(Error::from_reason(format!(
            "buffer curto: {} bytes para {}x{} (esperado {})",
            bgra.len(),
            width,
            height,
            expected
        )));
    }

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| Error::from_reason(format!("motor de OCR: {e}")))?;

    // `Buffer::Create(n)` devolve `Length = 0` — confirmado em `diag_buffer` —
    // e `CreateCopyFromBuffer` lê pelo Length, daí o 0xC00D7170 que não tinha
    // relação com o tamanho do recorte.
    //
    // `DataWriter` é o caminho que produz um IBuffer com Length correto:
    // escreve os bytes e entrega o buffer pronto. `LockBuffer` seria o
    // alternativo, mas o `BitmapBuffer` não implementa
    // `IMemoryBufferByteAccess` nesta build (E_NOINTERFACE).
    let writer = DataWriter::new()
        .map_err(|e| Error::from_reason(format!("DataWriter: {e}")))?;
    writer
        .WriteBytes(&bgra)
        .map_err(|e| Error::from_reason(format!("WriteBytes: {e}")))?;

    let buffer = writer
        .DetachBuffer()
        .map_err(|e| Error::from_reason(format!("DetachBuffer: {e}")))?;
    let software = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h)
        .map_err(|e| Error::from_reason(format!("CreateCopyFromBuffer: {e}")))?;

    let result = engine
        .RecognizeAsync(&software)
        .map_err(|e| Error::from_reason(format!("RecognizeAsync: {e}")))?;

    let recognized = wait_for(result)
        .map_err(|e| Error::from_reason(format!("reconhecimento: {e}")))?;

    let mut words: Vec<OcrWord> = Vec::new();
    if let Ok(lines) = recognized.Lines() {
        for line in lines {
            let Ok(ws) = line.Words() else { continue };
            for word in ws {
                let Ok(text) = word.Text() else { continue };
                let text = text.to_string();
                if text.trim().is_empty() {
                    continue;
                }
                let Ok(r) = word.BoundingRect() else { continue };
                words.push(OcrWord {
                    text,
                    x: r.X as f64,
                    y: r.Y as f64,
                    width: r.Width as f64,
                    height: r.Height as f64,
                    confidence: 1.0,
                });
            }
        }
    }

    let joined = words
        .iter()
        .map(|w| w.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    Ok(Some(OcrResult {
        words,
        text: joined,
        ms: t0.elapsed().as_secs_f64() * 1000.0,
    }))
}

/// Espera `IAsyncOperation` concluir, com teto de tempo.
///
/// Sem o teto, um runtime WinRT ocupado trava o worker de scan e, com ele, a
/// leitura inteira. Perder um frame de OCR é melhor que perder o loop.
fn wait_for<T: windows::core::RuntimeType>(
    op: windows_future::IAsyncOperation<T>,
) -> windows::core::Result<T> {
    const STEP_MS: u64 = 4;
    const MAX_MS: u64 = 1500;
    let mut waited = 0u64;
    loop {
        if let Ok(v) = op.GetResults() {
            return Ok(v);
        }
        if waited >= MAX_MS {
            return Err(windows::core::Error::from(windows::Win32::Foundation::E_FAIL));
        }
        std::thread::sleep(std::time::Duration::from_millis(STEP_MS));
        waited += STEP_MS;
    }
}
