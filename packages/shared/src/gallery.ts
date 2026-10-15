/**
 * Formato da galeria de icones (Fase 4a — template matching).
 *
 * Este arquivo e a implementacao canonica do formato: o construtor
 * (`tools/gallery-build.mjs`) e o classificador (`apps/workers`) usam os
 * MESMOS metodos, para que encode/decode nunca divirjam.
 *
 * ## Formato
 *
 * Cada item guarda uma assinatura "tiny image": grade 12x12 RGB (432 floats),
 * centralizada (media subtraida), L2-normalizada e quantizada para int8 em
 * base64.
 *
 * ```json
 * {
 *   "schema": 1, "grid": 12, "dims": 432, "count": 588,
 *   "items": { "acoustic_guitar": "IAEAAA...base64" }
 * }
 * ```
 *
 * ## Por que centralizar
 *
 * A media global e subtraida antes da normalizacao. Sem isso, o mesmo icone
 * casaria diferente conforme o fundo do inventario — o inventario, a loot
 * screen e o mapa tem fundos distintos para o mesmo item.
 *
 * ## Por que int8
 *
 * 588 itens x 432 floats = 254 KB em int8, contra ~1.5 MB em JSON de float.
 * A perda de precisao e irrelevante: o criterio de decisao e distancia, e 1/127
 * de granularidade nao muda o ranking.
 */

export const GALLERY_GRID = 12;
export const GALLERY_DIMS = GALLERY_GRID * GALLERY_GRID * 3;

export interface Gallery {
  schema: number;
  generatedAt: string;
  grid: number;
  dims: number;
  count: number;
  items: Record<string, string>;
}

export interface Match {
  itemId: string;
  score: number;
  /** segundo colocado — a margem diz se o palpite e confiavel */
  runnerUp: string | null;
  runnerUpScore: number;
}

/** Int8 -> base64. */
export function encodeSignature(values: Float32Array): string {
  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    const q = Math.round(Math.max(-1, Math.min(1, v)) * 127);
    bytes[i] = q & 0xff; // -2 vira 254; o decode reinterpreta com sinal
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * base64 -> Float32Array.
 *
 * O passo obrigatorio e o `> 127 ? - 256`: `atob` devolve bytes unsigned, e
 * sem isso todo valor negativo vira positivo — a assinatura fica com norma
 * ~34 em vez de 1 e o casamento vira lixo.
 */
export function decodeSignature(b64: string): Float32Array {
  const bin = atob(b64);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const byte = bin.charCodeAt(i);
    out[i] = (byte > 127 ? byte - 256 : byte) / 127;
  }
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Indice do maior valor — evita alocar array em laco quente. */
function argmax(values: Float32Array, skip: number): number {
  let best = -Infinity;
  let idx = -1;
  for (let i = 0; i < values.length; i++) {
    if (i === skip) continue;
    const v = values[i] ?? -Infinity;
    if (v > best) {
      best = v;
      idx = i;
    }
  }
  return idx;
}

export interface MatcherOptions {
  /** abaixo disso o item e considerado desconhecido */
  minScore: number;
  /** margem minima sobre o segundo colocado */
  minMargin: number;
}

/**
 * Casa uma assinatura contra a galeria.
 *
 * Devolve `null` quando nao ha aceitavel: nesse caso o HUD oferece nomear o
 * item, e a resposta vira correcao para a base da comunidade. Preferimos
 * "nao sei" a um palpite errado — stash avaliado errado e pior que stash sem
 * avaliacao.
 */
export function matchSignature(
  gallery: { items: Record<string, string>; ids: string[]; cache: Map<string, Float32Array> },
  signature: Float32Array,
  options: MatcherOptions = { minScore: 0.72, minMargin: 0.06 },
): Match | null {
  const ids = gallery.ids;
  const scores = new Float32Array(ids.length);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    let vec = gallery.cache.get(id);
    if (!vec) {
      vec = decodeSignature(gallery.items[id]!);
      gallery.cache.set(id, vec);
    }
    scores[i] = cosine(signature, vec);
  }

  const bestIdx = argmax(scores, -1);
  if (bestIdx < 0) return null;

  const top = scores[bestIdx]!;
  if (top < options.minScore) return null;

  const secondIdx = argmax(scores, bestIdx);
  const second = secondIdx >= 0 ? (scores[secondIdx] ?? 0) : 0;

  // margem insuficiente: dois icones quase iguais. Melhor perguntar.
  if (top - second < options.minMargin) return null;

  return {
    itemId: ids[bestIdx]!,
    score: top,
    runnerUp: secondIdx >= 0 ? ids[secondIdx]! : null,
    runnerUpScore: second,
  };
}

/** Indice da galeria pronto para inferencia (ids + cache). */
export function prepareGallery(gallery: Gallery): {
  items: Record<string, string>;
  ids: string[];
  cache: Map<string, Float32Array>;
} {
  const ids = Object.keys(gallery.items);
  return { items: gallery.items, ids, cache: new Map() };
}

/**
 * Recorte antes de assinar, em fracao do lado da celula.
 *
 * Medido contra 60 celulas reais de tres capturas (`tools/classifier-eval.mjs`):
 *
 * ```text
 *   recorte                     casados    nota     margem
 *   topo 13,5% + lado 6%           6/60    0,658    0,0910
 *   simetrico 12%                  0/60    0,348    0,0408
 *   simetrico 6%                   0/60    0,352    0,0465
 *   sem inset                      0/60    0,326    0,0537
 * ```
 *
 * O inset e **forte em cima e fraco nas laterais** porque a celula do jogo tem
 * a faixa da barra de durabilidade/quantidade em baixo (medido: 84..99 de 104)
 * e a borda de raridade em cima, enquanto o icone de referencia so tem arte.
 * Um recorte simetrico corta o icone em vez de tirar a moldura.
 */
export const DEFAULT_INSET = { top: 0.135, side: 0.06 } as const;

/**
 * Assinatura de uma celula a partir do batch do `cell-vision`.
 *
 * O batch vem em (N, 3, S, S) float 0..1 (CHW). Aqui reamostramos para a
 * grade da galeria — nao ha necessidade de recortar de novo do frame original,
 * e assim a assinatura e exatamente a mesma que a do icone de referencia
 * (mesmo caminho de downscale, mesma escala).
 *
 * ## Por que `inset`
 *
 * A celula detectada vem com a borda e uma margem de fundo em volta do icone.
 * O icone de referencia nao tem nada disso. Cortar a margem antes de assinar
 * e o que faz as duas imagens compararem — sem isso, borda + fundo dominam o
 * sinal e nenhuma celular casa.
 *
 * O valor padrao (12%) foi medido contra a galeria: com ele, o casamento
 * proprio passa de "sempre desconhecido" para 100% de precisao.
 */
export function signatureFromBatch(
  batch: Float32Array,
  batchSize: number,
  index: number,
  grid = GALLERY_GRID,
  inset: number | { top: number; side: number } = DEFAULT_INSET,
): Float32Array {
  const plane = batchSize * batchSize;
  const base = index * 3 * plane;
  if (base + 3 * plane > batch.length) {
    return new Float32Array(GALLERY_DIMS);
  }

  const top = typeof inset === 'number' ? inset : inset.top;
  const side = typeof inset === 'number' ? inset : inset.side;
  const padTop = Math.floor(batchSize * top);
  const padSide = Math.floor(batchSize * side);
  const innerW = Math.max(2, batchSize - 2 * padSide);
  const innerH = Math.max(2, batchSize - padTop - padSide);
  const out = new Float32Array(grid * grid * 3);

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      // media de bloco, igual ao downscale do construtor
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = padSide + Math.floor((gx * innerW) / grid);
      const y0 = padTop + Math.floor((gy * innerH) / grid);
      const x1 = Math.min(batchSize, padSide + Math.ceil(((gx + 1) * innerW) / grid));
      const y1 = Math.min(batchSize, padTop + Math.ceil(((gy + 1) * innerH) / grid));

      for (let y = y0; y < x1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * batchSize + x;
          r += batch[base + p] ?? 0;
          g += batch[base + plane + p] ?? 0;
          b += batch[base + 2 * plane + p] ?? 0;
          n++;
        }
      }

      const i = (gy * grid + gx) * 3;
      // Bloco sem pixel fica em 0. Nao usar 255 aqui: num grid que anda em
      // 0..255 um clarão em bloco vazio domina a variância e a assinatura
      // passa a descrever a geometria do recorte em vez do ícone.
      if (n === 0) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        continue;
      }
      const inv = 255 / n;
      out[i] = r * inv;
      out[i + 1] = g * inv;
      out[i + 2] = b * inv;
    }
  }

  // Normalização inline (mesma conta de `normalizeSignature`, mantida aqui
  // para o caminho de batch não depender de indireção). Imagem chapada sai
  // nula em vez de virar um vetor qualquer.
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;

  let norm2 = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i]! - mean) / 255;
    norm2 += out[i]! * out[i]!;
  }
  norm2 = Math.sqrt(norm2);
  if (norm2 < 1e-9) return new Float32Array(out.length); // imagem chapada
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm2;

  return out;
}

/** Centraliza (subtrai a media) e L2-normaliza. */
export function normalizeSignature(grid: Float32Array): Float32Array {  let mean = 0;
  for (const v of grid) mean += v;
  mean /= grid.length;

  const out = new Float32Array(grid.length);
  for (let i = 0; i < grid.length; i++) out[i] = ((grid[i] ?? 0) - mean) / 255;

  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / norm;
  return out;
}