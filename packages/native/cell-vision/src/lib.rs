#![allow(non_snake_case)]

//! Arc GX — deteccao de celulas de inventario (N-API, Rust puro).
//!
//! Entrada: um frame BGRA e a regiao de interesse do inventario.
//! Saida:   os retangulos das celulas em ordem de leitura, mais o batch
//!          normalizado pronto para o ONNX Runtime.
//!
//! ## Por que sem OpenCV
//!
//! A solucao de referencia empacota `opencv_world4*.dll` — 65 MB — para o
//! mesmo resultado. O `opencv` crate ainda exige `libclang` no build, o que
//! significa instalar ~1 GB de LLVM so para compilar. Para *achar quadrados
//! numa grade*, isso e desproporcional.
//!
//! O que este addon faz, em Rust puro, sem dependencia nativa:
//!
//! ```text
//!   BGRA -> grayscale (luma BT.709)
//!       -> box blur separavel 3x3
//!       -> Sobel (gradiente)
//!       -> perfil de projecao por linha e por coluna
//!       -> bandas (picos de borda) = a grade
//!       -> refino de cada celula por analise local
//!       -> recorte + resize bilinear -> tensor (N, 3, S, S) float 0..1
//! ```
//!
//! ## Por que perfil de projecao e melhor que contornos aqui
//!
//! `findContours` generico e a escolha natural, mas o inventario e uma **grade
//! regular**. Detectar as bandas horizontais e verticais da grade explora essa
//! estrutura: e mais estavel (um item claro dentro de uma celula nao quebra a
//! deteccao), mais rapido e bem mais simples de acertar.
//!
//! ## Contrato com o scan-worker
//!
//! - Lista vazia significa "o inventario esta fechado" — nao inferir nada.
//! - A ordem e sempre da esquerda para a direita, de cima para baixo.
//! - As coordenadas sao absolutas no frame, nao relativas a ROI.
//!
//! ## Anti-cheat
//!
//! Processa apenas os bytes do frame que o `wgc-capture` ja entregou. Nao
//! abre handle em processo, nao injeta input, nao toca em nada fora da nossa
//! memoria. Ver `docs/ANTICHEAT.md`.

use napi::bindgen_prelude::{Error, Float32Array, Uint8Array};
use napi_derive::napi;

/// lado do tensor de saida (entrada do classificador)
pub const CELL_SIZE: usize = 96;

/* ============================================================ tipos N-API */

#[napi(object)]
pub struct CellRect {
    pub index: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// 0..1. Grade regular confia em 1.0; celula refinada perde um pouco.
    pub confidence: f64,
}

#[napi(object)]
pub struct Roi {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
pub struct DetectorConfig {
    /// limiar do gradiente para considerar "borda"
    pub edge_threshold: f64,
    /// menor banda aceita na grade, em px
    pub min_cell: f64,
    /// maior banda aceita, em px
    pub max_cell: f64,
    /// contraste da borda sobre a mediana do perfil (0..1)
    pub band_energy: f64,
    /// bandas separadas por menos que isso sao a mesma borda
    pub merge_gap: f64,
    /// refina a borda de cada celula dentro do slot (0 = nao refina)
    pub refine: bool,
    /// margem em px aplicada SO na deteccao, para o Sobel da borda de
    /// contorno nao ser cortado pela ROI do chamador
    pub pad_px: f64,
}

impl Default for DetectorConfig {
    fn default() -> Self {
        Self {
            // Sobel aqui opera em 0..1 (luma normalizada), nao 0..255.
            edge_threshold: 0.22,
            min_cell: 16.0,
            max_cell: 400.0,
            // quanto a borda precisa se destacar da mediana do perfil
            band_energy: 0.45,
            merge_gap: 5.0,
            refine: true,
            // A borda de contorno precisa de ~6 px de contexto: o Sobel de 1 px
            // se espalha 2 px para cada lado, e o pico externo aparece em -2.
            pad_px: 8.0,
        }
    }
}

#[napi(object)]
pub struct Batch {
    /// (N, 3, S, S) float 0..1, layout CHW
    pub data: Float32Array,
    pub cells: Vec<CellRect>,
    pub cell_size: u32,
    pub ms: f64,
    /// bandas detectadas na horizontal e na vertical
    pub rows: u32,
    pub cols: u32,
}

#[napi(object)]
#[derive(Clone)]
pub struct VisionStats {
    pub calls: i64,
    pub last_cells: i64,
    pub last_ms: f64,
    pub last_rows: i32,
    pub last_cols: i32,
}

static STATS: std::sync::Mutex<VisionStats> = std::sync::Mutex::new(VisionStats {
    calls: 0,
    last_cells: 0,
    last_ms: 0.0,
    last_rows: 0,
    last_cols: 0,
});

#[napi]
pub fn stats() -> VisionStats {
    STATS.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/* ============================================================= imagem */

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Luma BT.709 — a mesma perceived brightness que o olho humano usa.
#[inline]
fn luma(b: u8, g: u8, r: u8) -> f32 {
    0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32
}

/// Recorta a ROI. Row-major, `width * 4` bytes por linha.
fn crop_bgra(frame: &[u8], fw: usize, fh: usize, roi: &Roi) -> Result<(Vec<u8>, usize, usize), Error> {
    if fw == 0 || fh == 0 {
        return Err(Error::from_reason("frame vazio"));
    }
    if frame.len() < fw * fh * 4 {
        return Err(Error::from_reason(format!(
            "frame tem {} bytes, esperado {} para {}x{}",
            frame.len(),
            fw * fh * 4,
            fw,
            fh
        )));
    }

    let x0 = (roi.x.max(0.0) as usize).min(fw - 1);
    let y0 = (roi.y.max(0.0) as usize).min(fh - 1);
    let w = (roi.width.max(1.0) as usize).min(fw - x0).max(1);
    let h = (roi.height.max(1.0) as usize).min(fh - y0).max(1);

    let row_bytes = w * 4;
    let mut out = Vec::with_capacity(row_bytes * h);
    for y in 0..h {
        let start = ((y0 + y) * fw + x0) * 4;
        out.extend_from_slice(&frame[start..start + row_bytes]);
    }
    Ok((out, w, h))
}

/// BGRA -> grayscale f32 normalizado 0..1.
fn to_gray(bgra: &[u8], w: usize, h: usize) -> Vec<f32> {
    let mut gray = vec![0f32; w * h];
    for (i, px) in bgra.chunks_exact(4).enumerate().take(w * h) {
        gray[i] = luma(px[0], px[1], px[2]) / 255.0;
    }
    gray
}

/// Box blur separavel 3x3. Mais rapido que gaussiana e suf��iente para
/// suavizar o ruido antes do gradiente.
fn box_blur3(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut tmp = vec![0f32; w * h];
    let mut dst = vec![0f32; w * h];

    for y in 0..h {
        for x in 0..w {
            let l = if x > 0 { src[y * w + x - 1] } else { src[y * w + x] };
            let r = if x + 1 < w { src[y * w + x + 1] } else { src[y * w + x] };
            tmp[y * w + x] = (l + src[y * w + x] + r) / 3.0;
        }
    }
    for y in 0..h {
        for x in 0..w {
            let t = if y > 0 { tmp[(y - 1) * w + x] } else { tmp[y * w + x] };
            let b = if y + 1 < h { tmp[(y + 1) * w + x] } else { tmp[y * w + x] };
            dst[y * w + x] = (t + tmp[y * w + x] + b) / 3.0;
        }
    }
    dst
}

/// Magnitude do gradiente (Sobel).
fn sobel_mag(gray: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut mag = vec![0f32; w * h];
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let i = y * w + x;
            let tl = gray[i - w - 1];
            let tc = gray[i - w];
            let tr = gray[i - w + 1];
            let ml = gray[i - 1];
            let mr = gray[i + 1];
            let bl = gray[i + w - 1];
            let bc = gray[i + w];
            let br = gray[i + w + 1];

            let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
            let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
            mag[i] = (gx * gx + gy * gy).sqrt();
        }
    }
    mag
}


/// Bandas da grade a partir do perfil de projecao.
/// Linhas de uma grade periodica em um perfil de projecao, e os pares que
/// formam as celulas.
///
/// Medido em captura real do ARC (1920x1080, sem escala):
///
/// ```text
///   celula 96 x 104   passo 104 x 104   origem (152, 367)
///   borda esquerda  x=152 | borda direita  x=247   (span 95)
///   borda superior  y=367 | (sem borda inferior: a seguinte serve de teto)
/// ```
///
/// O perfil de projecao tem DUAS treliças de passo 104 em cada eixo, e saber
/// qual delas e a borda e o que decide se o retangulo sai certo:
///
/// ```text
///   COLUNAS   residues 48 (esquerda: 152,256,360,464) e 39 (direita: 247,351,455,559)
///   LINHAS    residues 54 (borda: 366,470,574,678,782,886) e 66 (icone: 378,482,586,...)
/// ```
///
/// * nas colunas a segunda treliça E a outra borda da celula → os pares saem
///   de (esquerda[k], direita[k]), com span 95;
/// * nas linhas a segunda treliça NAO e borda, e a borda do icone ~11 px abaixo.
///   O par (borda[k], icone[k]) tem span 11, abaixo de `min_cell`, e por isso
///   e descartado — o emparelhamento cai para linhas consecutivas da treliça de
///   borda, com span 104. Correto.
///
/// O risco real e escolher a treliça errada. A do icone tem pico MAIS ALTO que
/// a da borda (medido: 0.708 contra 0.686), porque a arte do item tem mais
/// contraste que a linha de 1 px. Entao a escolha nao pode ser por altura.
///
/// Desempata pela ESTRUTURA: a grade e uma sequencia de celulas, e a celula
/// mais externa tem a borda na linha extrema. A treliça que contem o pico mais
/// a esquerda (ou mais acima) e a das bordas; a outra esta sempre para dentro.
///
/// 1. picos locais acima do limiar adaptativo
/// 2. passo = moda das diferencas entre picos consecutivos
/// 3. picos agrupados por residuo modulo o passo
/// 4. A = residuo do pico EXTREMO (primeira celula da grade)
/// 5. B = residuo mais populado distinto de A
/// 6. celulas = (A[k], B[k]); se o span for invalido, cai para A consecutivo
fn grid_lines(profile: &[f32], min_cell: f64, max_cell: f64) -> Vec<usize> {
    // A janela do maximo local precisa acompanhar a escala da celula: fixa em
    // 2 px ela achata picos vizinhos numa tela pequena e engole o maximo
    // numa grande. `min_cell` ja vem escalado pelo chamador, entao serve de
    // medida de referencia antes mesmo de conhecer o passo.
    let radius = ((min_cell / 8.0) as usize).max(1);
    let peaks = profile_peaks(profile, radius);
    if peaks.len() < 2 {
        return peaks;
    }
    let lines = split_lattices(profile, &peaks, min_cell, max_cell);
    lines
}

/// Picos locais acima de um limiar adaptativo (mediana + fracao da amplitude).
fn profile_peaks(profile: &[f32], radius: usize) -> Vec<usize> {
    let n = profile.len();
    if n < 8 {
        return Vec::new();
    }
    let peak = profile.iter().cloned().fold(0.0f32, f32::max);
    if peak <= 0.0 {
        return Vec::new();
    }
    let mut sorted = profile.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let base = sorted[sorted.len() / 2];
    let gate = base + (peak - base) * 0.35;

    let radius = radius.min(n / 2).max(1);
    let mut peaks: Vec<usize> = Vec::new();
    for i in radius..n.saturating_sub(radius) {
        let v = profile[i];
        if v < gate {
            continue;
        }
        if (i - radius..=i + radius).all(|j| profile[j] <= v) {
            peaks.push(i);
        }
    }
    peaks
}

/// Separa os picos nas trelicas da grade e devolve as linhas que delimitam as
/// celulas.
///
/// Cada eixo tem DUAS trelicas de passo 104, e qual delas e a borda decide se
/// o retangulo sai certo.
///
/// ```text
///   COLUNAS   residuo 48 = esquerda (152,256,360,464)
///             residuo 39 = direita  (247,351,455,559)   -> celula de 95
///   LINHAS    residuo 54 = borda   (366,470,574,678,782,886)
///             residuo 66 = icone   (378,482,586,690,794,898)  -> nao e borda
/// ```
///
/// Regras, na ordem:
///
/// 1. **A e a treliça do pico extremo.** A primeira celula visivel tem a borda
///    na linha mais externa; toda outra estrutura esta deslocada para dentro.
///    Escolher pela altura do pico nao funciona: o do icone e MAIS ALTO que o
///    da borda (medido 0.708 contra 0.686), porque a arte do item tem mais
///    contraste que uma linha de 1 px.
///
/// 2. **A segunda treliça so entra se fechar uma caixa de verdade.** No eixo X
///    ela e a borda direita e o par (152,247) da a celula de 95 px. No eixo Y
///    ela e a borda do icone, o par (366,378) da span 11 — abaixo de
///    `min_cell`, descartado — e o emparelhamento cai para linhas consecutivas.
///
/// 3. **Uma borda e seguida de vazio.** Criterio de desempate entre varias
///    hipoteses de caixa: depois da linha que fecha a celula tem uma faixa
///    escura antes da proxima linha. No eixo X o gap de 8 px entre celulas e
///    escuro; depois da borda direita nao ha nada. Isso separa "a linha fecha
///    uma caixa" de "a linha e a borda esquerda da proxima celula".
fn split_lattices(
    profile: &[f32],
    peaks: &[usize],
    min_cell: f64,
    max_cell: f64,
) -> Vec<usize> {
    let n = peaks.len();
    if n < 2 {
        return peaks.to_vec();
    }

    // passo por AUTOCORRELACAO normalizada do perfil
    //
    // A moda das diferencas entre picos NAO funciona aqui: com duas trelicas
    // de passo 104 defasadas em ~12 px, os intervalos entre uma linha e a
    // linha da outra trelica (~91 px) sao mais frequentes que o passo real
    // (104 px), e a moda devolve 91 — errado.
    //
    // A autocorrelacao nao sofre disso: a defasagem entre as trelicas e
    // decorrelacionada, entao so o periodo comum (104) pontua alto.
    let pitch = comb_pitch(profile, min_cell.max(8.0), max_cell.min(profile.len() as f64 / 2.0));
    if pitch == 0 {
        return peaks.to_vec();
    }

    // Tolerancias em FRACAO do passo, nao em pixels.
    //
    // Medido em 6 resolucoes: com tolerancia fixa de 3 px, 2560x1440 (passo
    // 139) agrupava residues demais e devolvia 5x11 com celula de 16 px; com
    // 960x540 (passo 52) a mesma tolerancia engolia linhas vizinhas. 3 px so
    // era a medida certa na resolucao em que a grade foi medida.
    let tol = ((pitch as f64 * 0.03) as usize).max(2);

    // agrupa por residuo, com tolerancia circular
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    let mut residues: Vec<usize> = Vec::new();
    for &p in peaks {
        let r = p % pitch;
        match residues.iter().position(|&cr| ring_diff(cr, r, pitch) <= tol) {
            Some(i) => clusters[i].push(p),
            None => {
                residues.push(r);
                clusters.push(vec![p]);
            }
        }
    }
    clusters.retain(|c| c.len() >= 2);
    if clusters.len() < 2 {
        return clusters.into_iter().flatten().collect();
    }

    // A = cluster que contem o pico extremo
    let first = peaks[0];
    let ia = residues
        .iter()
        .position(|&r| ring_diff(r, first % pitch, pitch) <= tol)
        .unwrap_or(0);
    let a = clusters[ia].clone();

    // hipoteses de caixa varrendo as outras trelicas, mais populada primeiro
    let mut others: Vec<usize> = (0..clusters.len()).filter(|&i| i != ia).collect();
    others.sort_by(|&x, &y| clusters[y].len().cmp(&clusters[x].len()));

    for i in others {
        let b = &clusters[i];
        let mut pairs: Vec<(usize, usize)> = Vec::new();
        for &va in a.iter() {
            if let Some(&vb) = b.iter().find(|&&x| x > va) {
                let d = (vb - va) as f64;
                if d >= min_cell && d <= max_cell {
                    pairs.push((va, vb));
                }
            }
        }
        if pairs.len() < 2 {
            continue;
        }
        let closed = pairs
            .iter()
            .all(|&(_, end)| gap_is_cold(profile, end, pitch, peaks));
        if !closed {
            continue;
        }
        let mut out: Vec<usize> = Vec::new();
        for (s, e) in pairs {
            out.push(s);
            out.push(e);
        }
        out.sort_unstable();
        out.dedup();
        return out;
    }

    a
}

/// Depois da linha `from`, ha uma faixa escura antes da proxima estrutura?
///
/// Sem isso, "borda direita da celula 0" e "borda esquerda da celula 1" sao
/// indistinguiveis: as duas viram uma linha unica e a celula ganha o gap.
fn gap_is_cold(profile: &[f32], from: usize, pitch: usize, peaks: &[usize]) -> bool {
    let n = profile.len();
    let limit = (from + pitch.max(4)).min(n);
    let next = peaks
        .iter()
        .copied()
        .find(|&p| p > from)
        .unwrap_or(limit);
    if next <= from + 1 {
        return false;
    }
    let peak = profile.iter().cloned().fold(0.0f32, f32::max);
    let cold = peak * 0.2;
    (from + 1..next).any(|i| profile[i] < cold)
}

/// Periodo de um perfil periodico, pela autocorrelacao normalizada.
///
/// Procura o atraso `L` que melhor alinha o perfil com ele mesmo. E o certo
/// quando o perfil tem varias trelicas: o que distingue o passo do deslocamento
/// entre elas e que so o passo survives a correlacao.
fn comb_pitch(profile: &[f32], min_lag: f64, max_lag: f64) -> usize {
    let n = profile.len();
    let lo = (min_lag as usize).max(2);
    let hi = ((max_lag as usize).min(n / 2)).max(lo + 1);
    if hi <= lo {
        return 0;
    }
    let e0: f32 = profile.iter().map(|v| v * v).sum();
    if e0 <= 0.0 {
        return 0;
    }

    let mut best_lag = 0usize;
    let mut best_corr = f32::MIN;
    for lag in lo..=hi {
        let mut s = 0f32;
        let mut e = 0f32;
        for i in 0..(n - lag) {
            s += profile[i] * profile[i + lag];
            e += profile[i + lag] * profile[i + lag];
        }
        let denom = (e0 * e).sqrt();
        if denom <= 0.0 {
            continue;
        }
        let c = s / denom;
        if c > best_corr {
            best_corr = c;
            best_lag = lag;
        }
    }
    best_lag
}

/// Geometria medida de uma ROI, no formato que o app persiste por resolucao.
#[napi(object)]
pub struct GridSpec {
    /// celula detectada
    pub cell_width: f64,
    pub cell_height: f64,
    /// distancia entre inicio de celulas vizinhas
    pub pitch: f64,
    pub cols: u32,
    pub rows: u32,
    /// origem da grade dentro da ROI
    pub origin_x: f64,
    pub origin_y: f64,
    /// confianca 0..1
    pub confidence: f64,
}

/// Diferenca circular entre residuos, no anel de tamanho `pitch`.
fn ring_diff(a: usize, b: usize, pitch: usize) -> usize {
    let d = if a > b { a - b } else { b - a };
    d.min(pitch - d)
}

/// Pares consecutivos de linhas cujo span vira uma celula.
fn pairs_of(lines: &[usize], min_cell: f64, max_cell: f64) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    for w in lines.windows(2) {
        let span = (w[1] - w[0]) as f64;
        if span >= min_cell && span <= max_cell {
            pairs.push((w[0], w[1]));
        }
    }
    pairs
}


/* ================================================= deteccao completa */

/// Configuracao do detector com as tolerancias ajustadas a uma escala.
///
/// Os paddings e as janelas internas do detector sao em pixels, mas a celula
/// do inventario escala com a resolucao: 96 px em 1920x1080 e 48 px em
/// 960x540. Deixar os dois no mesmo valor numerico acerta uma resolucao e
/// estraga a outra — medido em 6 escalas, sem isso apenas 2 davam grade certa.
fn config_for_scale(base: &DetectorConfig, scale: f64) -> DetectorConfig {
    let s = scale.clamp(0.25, 4.0);
    DetectorConfig {
        min_cell: base.min_cell * s,
        max_cell: base.max_cell * s,
        pad_px: base.pad_px * s,
        merge_gap: base.merge_gap * s,
        edge_threshold: base.edge_threshold,
        band_energy: base.band_energy,
        refine: base.refine,
    }
}

/// Mede a grade de uma ROI e devolve a geometria, sem montar batch.
///
/// Existe para o app persistir a geometria por resolucao: uma vez medida, ela
/// e confiavel e o detector deixa de ser caminho critico.
#[napi]
pub fn calibrate(
    frame: Uint8Array,
    width: u32,
    height: u32,
    roi: Roi,
    config: Option<DetectorConfig>,
) -> Result<Option<GridSpec>, Error> {
    let cfg = config.unwrap_or_default();
    let pad = cfg.pad_px as i64;
    let fx = roi.x as i64;
    let fy = roi.y as i64;
    let padded = Roi {
        x: (fx - pad).max(0) as f64,
        y: (fy - pad).max(0) as f64,
        width: ((roi.width.max(1.0) as i64) + pad * 2).max(1) as f64,
        height: ((roi.height.max(1.0) as i64) + pad * 2).max(1) as f64,
    };

    let (region, w, h) = crop_bgra(&frame, width as usize, height as usize, &padded)?;
    let (found, nrows, ncols) = detect(&region, w, h, &cfg);
    let first = match found.first() {
        Some(f) => f,
        None => return Ok(None),
    };

    // passo = distancia entre inicios de celulas vizinhas
    let pitch_x = found
        .iter()
        .find(|f| (f.0 - first.0).abs() > 1.0)
        .map(|f| (f.0 - first.0).abs())
        .unwrap_or(first.2);
    let pitch_y = found
        .iter()
        .find(|f| (f.1 - first.1).abs() > 1.0)
        .map(|f| (f.1 - first.1).abs())
        .unwrap_or(first.3);

    Ok(Some(GridSpec {
        cell_width: first.2,
        cell_height: first.3,
        pitch: (pitch_x + pitch_y) / 2.0,
        cols: ncols as u32,
        rows: nrows as u32,
        origin_x: first.0 + padded.x - fx as f64,
        origin_y: first.1 + padded.y - fy as f64,
        confidence: first.4,
    }))
}

fn detect(
    bgra: &[u8],
    w: usize,
    h: usize,
    cfg: &DetectorConfig,
) -> (Vec<(f64, f64, f64, f64, f64)>, usize, usize) {
    let gray = to_gray(bgra, w, h);
    let blurred = box_blur3(&gray, w, h);
    let mag = sobel_mag(&blurred, w, h);

    let mut strong = vec![false; w * h];
    for (i, &m) in mag.iter().enumerate() {
        strong[i] = m >= cfg.edge_threshold as f32;
    }

    // perfil por linha: bordas horizontais (topo/base das celulas)
    let mut row_prof = vec![0f32; h];
    for y in 0..h {
        let mut s = 0.0;
        for x in 0..w {
            if strong[y * w + x] {
                s += 1.0;
            }
        }
        row_prof[y] = s / w as f32;
    }

    // perfil por coluna: bordas verticais (esquerda/direita das celulas)
    let mut col_prof = vec![0f32; w];
    for x in 0..w {
        let mut s = 0.0;
        for y in 0..h {
            if strong[y * w + x] {
                s += 1.0;
            }
        }
        col_prof[x] = s / h as f32;
    }

    let rows = grid_lines(&row_prof, cfg.min_cell, cfg.max_cell);
    let cols = grid_lines(&col_prof, cfg.min_cell, cfg.max_cell);

    let row_cells = pairs_of(&rows, cfg.min_cell, cfg.max_cell);
    let col_cells = pairs_of(&cols, cfg.min_cell, cfg.max_cell);

    let mut out = Vec::with_capacity(row_cells.len() * col_cells.len());
    for (ry, rh) in &row_cells {
        for (cx, cw) in &col_cells {
            let bw = *cw as f64 - *cx as f64;
            let bh = *rh as f64 - *ry as f64;
            if bw < cfg.min_cell || bh < cfg.min_cell {
                continue;
            }
            let ratio = bw / bh;
            if !(0.55..=1.9).contains(&ratio) {
                continue;
            }
            let conf = (1.0 - (ratio - 1.0).abs() * 0.6).clamp(0.3, 1.0);
            out.push((*cx as f64, *ry as f64, bw, bh, conf));
        }
    }

    (out, row_cells.len(), col_cells.len())
}

/* ==================================================== montagem do batch */

/// Recorte bilinear + normaliza para o tensor (N, 3, S, S).
fn build_batch(
    bgra: &[u8],
    w: usize,
    h: usize,
    cells: &[(f64, f64, f64, f64, f64)],
    size: usize,
) -> Vec<f32> {
    let plane = size * size;
    let mut out = vec![0f32; cells.len() * 3 * plane];
    if cells.is_empty() {
        return out;
    }

    for (n, (cx, cy, cw, ch, _)) in cells.iter().enumerate() {
        let sx0 = cx.max(0.0);
        let sy0 = cy.max(0.0);
        let sw = cw.max(1.0);
        let sh = ch.max(1.0);

        for py in 0..size {
            // O deslocamento da celula precisa entrar AQUI. Sem `+ sy0` todas as
            // celulas amostram o topo da regiao e o batch sai identico para
            // todas — o classificador nunca teria como acertar, e nada no
            // resultado denuncia: a grade tem o tamanho certo, so o conteudo e
            // sempre o mesmo.
            let fy = sy0 + (py as f64 + 0.5) * sh / size as f64 - 0.5;
            let y0 = fy.floor();
            let wy = fy - y0;
            let y0i = (y0.max(0.0) as usize).min(h.saturating_sub(1));
            let y1i = (y0i + 1).min(h.saturating_sub(1));

            for px in 0..size {
                let fx = sx0 + (px as f64 + 0.5) * sw / size as f64 - 0.5;
                let x0 = fx.floor();
                let wx = fx - x0;
                let x0i = (x0.max(0.0) as usize).min(w.saturating_sub(1));
                let x1i = (x0i + 1).min(w.saturating_sub(1));

                let p00 = &bgra[(y0i * w + x0i) * 4..(y0i * w + x0i) * 4 + 3];
                let p01 = &bgra[(y0i * w + x1i) * 4..(y0i * w + x1i) * 4 + 3];
                let p10 = &bgra[(y1i * w + x0i) * 4..(y1i * w + x0i) * 4 + 3];
                let p11 = &bgra[(y1i * w + x1i) * 4..(y1i * w + x1i) * 4 + 3];

                let mut ch3 = [0f32; 3];
                for c in 0..3 {
                    let top = p00[c] as f32 + (p01[c] as f32 - p00[c] as f32) * wx as f32;
                    let bot = p10[c] as f32 + (p11[c] as f32 - p10[c] as f32) * wx as f32;
                    let v = top + (bot - top) * wy as f32;
                    ch3[c] = (v / 255.0).clamp(0.0, 1.0);
                }

                let p = py * size + px;
                let base = n * 3 * plane + p;
                out[base] = ch3[2];
                out[base + plane] = ch3[1];
                out[base + 2 * plane] = ch3[0];
            }
        }
    }

    out
}

#[napi]
pub const CELL_SIZE_PX: u32 = CELL_SIZE as u32;

/// Detecta as celulas na ROI e monta o batch do classificador.
#[napi]
pub fn prepare_classifier_batch(
    frame: Uint8Array,
    width: u32,
    height: u32,
    roi: Roi,
    cell_size: Option<u32>,
    config: Option<DetectorConfig>,
) -> Result<Batch, Error> {
    let t0 = now_ms();
    let cfg = config.unwrap_or_default();
    let size = cell_size.unwrap_or(CELL_SIZE as u32) as usize;
    if size == 0 {
        return Err(Error::from_reason("cell_size deve ser >= 1"));
    }

    // A ROI do chamador e a area VISIVEL da grade, e suas bordas cortam
    // exatamente as linhas de contorno. O Sobel de uma borda de 1 px se
    // espalha para os dois lados; sem o pixel de fora, o pico do lado interno
    // fica sozinho e mais alto que o externo — e a grade desliza para dentro
    // (~11 px, medido).
    //
    // Entao a deteccao roda sobre a ROI achatada por uma margem, e o resultado
    // volta para as coordenadas do frame.
    let pad = cfg.pad_px as i64;
    let fx = roi.x as i64;
    let fy = roi.y as i64;
    let fw = roi.width.max(1.0) as i64;
    let fh = roi.height.max(1.0) as i64;
    let padded = Roi {
        x: (fx - pad).max(0) as f64,
        y: (fy - pad).max(0) as f64,
        width: (fw + pad * 2).max(1) as f64,
        height: (fh + pad * 2).max(1) as f64,
    };

    let (region, w, h) = crop_bgra(&frame, width as usize, height as usize, &padded)?;
    let (found, nrows, ncols) = detect(&region, w, h, &cfg);

// `found` vem em coordenadas da regiao recortada; a regiao comeca em padded.x
    let ox = padded.x;
    let oy = padded.y;

    let cells: Vec<CellRect> = found
        .iter()
        .enumerate()
        .map(|(i, (x, y, cw, ch, conf))| CellRect {
            index: i as u32,
            x: x + ox,
            y: y + oy,
            width: *cw,
            height: *ch,
            confidence: *conf,
        })
        .collect();

    let data = build_batch(&region, w, h, &found, size);
    let ms = now_ms() - t0;

    {
        let mut s = STATS.lock().unwrap_or_else(|e| e.into_inner());
        s.calls += 1;
        s.last_cells = cells.len() as i64;
        s.last_ms = ms;
        s.last_rows = nrows as i32;
        s.last_cols = ncols as i32;
    }

    Ok(Batch {
        data: Float32Array::new(data),
        cells,
        cell_size: size as u32,
        ms,
        rows: nrows as u32,
        cols: ncols as u32,
    })
}

/// BGRA -> RGBA, para origem em RGBA (ex.: PNG decodificado).
fn bgra_to_rgba(src: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(src.len());
    for px in src.chunks_exact(4) {
        out.push(px[2]);
        out.push(px[1]);
        out.push(px[0]);
        out.push(px[3]);
    }
    out
}

#[napi(object)]
pub struct Profiles {
    pub rows: Float32Array,
    pub cols: Float32Array,
    pub row_bands: Vec<u32>,
    pub col_bands: Vec<u32>,
}

/// Perfis de projecao brutos — diagnostico para calibrar `band_energy` e
/// `edge_threshold` contra um inventario real, em vez de chutar.
#[napi]
pub fn profile(
    frame: Uint8Array,
    width: u32,
    height: u32,
    config: Option<DetectorConfig>,
) -> Result<Profiles, Error> {
    let cfg = config.unwrap_or_default();
    let fw = width as usize;
    let fh = height as usize;

    let gray = to_gray(&frame, fw, fh);
    let blurred = box_blur3(&gray, fw, fh);
    let mag = sobel_mag(&blurred, fw, fh);
    let thr = cfg.edge_threshold as f32;

    let mut row_prof = vec![0f32; fh];
    for y in 0..fh {
        let mut s = 0.0;
        for x in 0..fw {
            if mag[y * fw + x] >= thr {
                s += 1.0;
            }
        }
        row_prof[y] = s / fw as f32;
    }

    let mut col_prof = vec![0f32; fw];
    for x in 0..fw {
        let mut s = 0.0;
        for y in 0..fh {
            if mag[y * fw + x] >= thr {
                s += 1.0;
            }
        }
        col_prof[x] = s / fh as f32;
    }

    let rows = grid_lines(&row_prof, cfg.min_cell, cfg.max_cell);
    let cols = grid_lines(&col_prof, cfg.min_cell, cfg.max_cell);

    Ok(Profiles {
        rows: Float32Array::new(row_prof),
        cols: Float32Array::new(col_prof),
        row_bands: rows.iter().map(|v| *v as u32).collect(),
        col_bands: cols.iter().map(|v| *v as u32).collect(),
    })
}

#[napi]
pub fn prepare_classifier_batch_rgba(
    frame: Uint8Array,
    width: u32,
    height: u32,
    roi: Roi,
    cell_size: Option<u32>,
    config: Option<DetectorConfig>,
) -> Result<Batch, Error> {
    let bgra = bgra_to_rgba(&frame);
    prepare_classifier_batch(Uint8Array::new(bgra), width, height, roi, cell_size, config)
}