/**
 * Construtor da galeria de ícones.
 *
 * ## Por que isso precisa existir
 *
 * A galeria que estava em `models/gallery.json` foi **copiada da referência**,
 * e as assinaturas dela foram feitas pelo pipeline proprietário deles. Não há
 * como saber o downscale, o inset nem o layout que usaram — e o teste de
 * round-trip provou isso na prática: alimentar uma assinatura da galeria pelo
 * mesmo caminho da consulta devolvia cosine ≈ 0, quando a identidade exige 1.0.
 * Duas implementações, dois espaços.
 *
 * A saída deste script é uma galeria no **mesmo espaço** de
 * `signatureFromBatch`, construída a partir da arte real do catálogo. Isso não é
 * otimização: é a condição para o casamento ter significado.
 *
 * ## Geometria da célula
 *
 * A assinatura de uma célula remove a moldura (borda de raridade em cima, barra
 * de quantidade embaixo) antes de assinar. Para a galeria ser comparável, o
 * ícone tem de ser montado **na mesma posição** que ocupa dentro da célula do
 * jogo. Essa posição é um parâmetro: a célula medida tem 96 px, o ícone ocupa
 * aproximadamente y 25..58 e vem centralizado. Como é medido, não suposto,
 * `tools/gallery-build.mjs` grava os parâmetros usados e
 * `tools/gallery-calibrate.mjs` procura os melhores.
 *
 * A arte é baixada, reduzida e descartada: em disco fica só o
 * `gallery.json`, com ~350 KB.
 */

import { inflateSync } from 'node:zlib';

export const S = 96; // lado da célula em pixels
export const G = 12; // grade da assinatura

/* ------------------------------------------------------------ PNGDecode */

/**
 * Decodificador PNG mínimo: 8 bits por canal, cores 2 (RGB), 3 (paleta) e
 * 6 (RGBA), sem entrelaçamento. É o que a arte da CDN usa.
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('não é png');
  let off = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    off += 12 + len;
  }

  if (!ihdr) throw new Error('sem IHDR');
  if (ihdr.depth !== 8) throw new Error(`bit depth ${ihdr.depth}`);
  if (ihdr.interlace !== 0) throw new Error('entrelaçado');

  const indice = ihdr.color === 3;
  const canais = ihdr.color === 6 ? 4 : ihdr.color === 2 ? 3 : indice ? 1 : null;
  if (!canais) throw new Error(`color type ${ihdr.color}`);
  if (indice && !plte) throw new Error('paleta sem PLTE');

  const raw = inflateSync(Buffer.concat(idat));
  const { w, h } = ihdr;
  const stride = w * canais;
  const out = Buffer.alloc(h * stride);

  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filtro = raw[pos++];
    const linha = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= canais ? cur[x - canais] : 0;
      const b = prev[x];
      const c = x >= canais ? prev[x - canais] : 0;
      let v = linha[x];
      switch (filtro) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`filtro ${filtro}`);
      }
      cur[x] = v & 0xff;
    }
  }

  // expande índice -> RGBA
  if (indice) {
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const k = out[i];
      rgba[i * 4] = plte[k * 3];
      rgba[i * 4 + 1] = plte[k * 3 + 1];
      rgba[i * 4 + 2] = plte[k * 3 + 2];
      rgba[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255;
    }
    return { w, h, canais: 4, data: rgba };
  }
  return { w, h, canais, data: out };
}

/* -------------------------------------------------------------- montage */

/**
 * Monta a célula sintética: fundo neutro + ícone no retângulo do parâmetro.
 *
 * A cor de fundo não é decorativa. A assinatura subtrai a média, então um
 * fundo claro e um escuro produzem o mesmo contraste — mas a *textura* do fundo
 * vira ruído. Um cinza chapado é o fundo que minimiza isso e é o que o HUD
 * mostra por baixo do ícone.
 */
export function montarCelula(img, { x, y, size, fundo = [46, 42, 36] }) {
  const out = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    out[i * 3] = fundo[0];
    out[i * 3 + 1] = fundo[1];
    out[i * 3 + 2] = fundo[2];
  }

  // fator deDownscale com média de área: point sampling em 512->30 derruba
  // detalhe fino e a assinatura vira ruído
  const escala = size / Math.min(img.w, img.h);
  const alvoW = Math.max(1, Math.round(img.w * escala));
  const alvoH = Math.max(1, Math.round(img.h * escala));
  const px = img.canais === 4 ? 4 : 3;

  for (let dy = 0; dy < alvoH; dy++) {
    const cy = y + dy;
    if (cy < 0 || cy >= S) continue;
    for (let dx = 0; dx < alvoW; dx++) {
      const cx = x + dx;
      if (cx < 0 || cx >= S) continue;

      // média da área de origem que cai neste pixel de destino
      const sx0 = Math.floor((dx * img.w) / alvoW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * img.w) / alvoW));
      const sy0 = Math.floor((dy * img.h) / alvoH);
      const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * img.h) / alvoH));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const p = (sy * img.w + sx) * px;
          const av = px === 4 ? img.data[p + 3] : 255;
          r += img.data[p];
          g += img.data[p + 1];
          b += img.data[p + 2];
          a += av;
          n++;
        }
      }
      if (!n) continue;
      r /= n; g /= n; b /= n; a /= n;
      if (a < 8) continue; // transparente não pinta

      const d = (cy * S + cx) * 3;
      const m = a / 255;
      out[d] = Math.round(out[d] * (1 - m) + r * m);
      out[d + 1] = Math.round(out[d + 1] * (1 - m) + g * m);
      out[d + 2] = Math.round(out[d + 2] * (1 - m) + b * m);
    }
  }

  return out;
}

/** Célula RGB 0..255 -> batch (3, S, S) float 0..1, como o cell-vision devolve. */
export function celulaParaBatch(rgb) {
  const plano = S * S;
  const batch = new Float32Array(3 * plano);
  for (let i = 0; i < plano; i++) {
    batch[i] = rgb[i * 3] / 255;
    batch[plano + i] = rgb[i * 3 + 1] / 255;
    batch[2 * plano + i] = rgb[i * 3 + 2] / 255;
  }
  return batch;
}

/**
 * Reamostragem bilinear idêntica à de `cell-vision` (`build_batch` no Rust).
 *
 * ## Por que precisa ser a mesma
 *
 * O Rust reamostra a célula **inteira** para `size × size` (12 no caminho de
 * produção) e só depois o classificador aplica o `inset`, em escala de 12 px.
 * Se a galeria for assinada em 96×96, os dois lados enxergam proporções
 * diferentes de ícone e moldura — e o casamento não acontece mais, por mais
 * parecida que a geometra esteja. As duas metades precisam ler a mesma região.
 *
 * O algoritmo abaixo é a transliteração do laço do Rust, Nikolai-Chaiklin e
 * a mesma ordem de canais (entrada RGB -> saída R, G, B em planos separados).
 */
export function reamostrarBilinear(rgb, size, srcW = S, srcH = S) {
  const out = new Float32Array(3 * size * size);
  const src = (x, y, c) => {
    const cx = Math.min(srcW - 1, Math.max(0, x));
    const cy = Math.min(srcH - 1, Math.max(0, y));
    return rgb[(cy * srcW + cx) * 3 + c] / 255;
  };

  for (let py = 0; py < size; py++) {
    const fy = (py + 0.5) * (srcH / size) - 0.5;
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    for (let px = 0; px < size; px++) {
      const fx = (px + 0.5) * (srcW / size) - 0.5;
      const x0 = Math.floor(fx);
      const wx = fx - x0;

      for (let c = 0; c < 3; c++) {
        const p00 = src(x0, y0, c);
        const p01 = src(x0 + 1, y0, c);
        const p10 = src(x0, y0 + 1, c);
        const p11 = src(x0 + 1, y0 + 1, c);
        const top = p00 + (p01 - p00) * wx;
        const bot = p10 + (p11 - p10) * wx;
        const v = Math.min(1, Math.max(0, top + (bot - top) * wy));
        out[c * size * size + py * size + px] = v;
      }
    }
  }
  return out;
}
