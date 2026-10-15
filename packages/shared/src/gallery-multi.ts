/**
 * Assinatura perceptual multiescala.
 *
 * ## Por que a grade 12×12 não discriminava
 *
 * A assinatura por média de bloco guarda 432 números sobre uma região de
 * ~60×60 px — blocos de 6×6 px. Isso é essencialmente uma borra: ícones com
 * a mesma silhueta e a mesma paleta viram o mesmo vetor. Medido na captura
 * real, o classificador acertava a nota (20/20 acima de 0,90) e perdia na
 * margem — primeiro e segundo colocados empatados. Trocar a grade para 14/16/
 * 20/24/28 não resolveu: a margem ficou em ~0,005 em todas.
 *
 * ## O que esta assinatura faz
 *
 * Três descritores complementares, cada um normalizado antes de concatenar:
 *
 * 1. **dHash 8×8** — 64 bits de comparação horizontal em escala grossa:
 *    pegou o desenho geral do ícone.
 * 2. **dHash 16×16** — 256 bits: bordas internas e detalhe fino.
 * 3. **Cor 4×4** — 48 valores: onde a massa de cor está no quadro.
 *
 * Cada bloco é normalizado para norma 1 antes de entrar, senão o dHash grosso
 * (64 floats) domina o detalhe (256) só por ter mais massa, e a cor vira
 * ruído. O resultado é L2-normalizado, o que mantém a comparação por cosseno
 * já existente.
 *
 * A assinatura é **invariante a brilho** no dHash (só compara adjacentes) e
 * **preserva cor** no terceiro bloco — que é a combinação que o item precisa:
 * dois ícones com a mesma forma e cores diferentes não podem virar o mesmo id.
 */

export const SIG_LUMI = 0.299;
export const SIG_G = 0.587;
export const SIG_B = 0.114;

export interface MultiOpts {
  /** escalas do dHash, em px do lado maior */
  escalas: number[];
  /** lado da grade de cor */
  corGrade: number;
}

/** Padrão: 8 e 16 para o dHash, 4×4 para a cor. */
export const DEFAULT_MULTI: MultiOpts = { escalas: [8, 16], corGrade: 4 };

export function multiDims(o: MultiOpts = DEFAULT_MULTI): number {
  let n = 0;
  for (const e of o.escalas) n += e * e;
  n += o.corGrade * o.corGrade * 3;
  return n;
}

/**
 * Reduz a região para `dst`×`dst` por média de área.
 *
 * Point sampling em 60→8 joga fora detalhe e vira ruído; média de área é o que
 * mantém o dHash estável.
 */
function reduzir(
  r: Float32Array,
  rw: number,
  rh: number,
  dw: number,
  dh: number,
  out: Float32Array,
): void {
  const cx = rw / dw;
  const cy = rh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * cy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * cy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * cx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * cx));
      let s = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < rh; sy++) {
        for (let sx = x0; sx < x1 && sx < rw; sx++) {
          s += r[sy * rw + sx]!;
          n++;
        }
      }
      out[y * dw + x] = n ? s / n : 0;
    }
  }
}

/** Luminância 0..255 de uma região RGB plana (3 floats por pixel). */
function luminancia(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  off: number,
): number {
  return r[off]! * SIG_LUMI + g[off]! * SIG_G + b[off]! * SIG_B;
}

/**
 * dHash: compara cada pixel com o vizinho da direita, em grade N×N.
 *
 * Devolve N² valores em {-1, +1}. O bit carrega **forma e borda**, que é
 * exatamente o que a média de bloco joga fora.
 */
function dHash(
  lum: Float32Array,
  n: number,
  out: Float32Array,
  off: number,
): number {
  let k = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[off + k++] = lum[y * (n + 1) + x + 1]! > lum[y * (n + 1) + x]! ? 1 : -1;
    }
  }
  return k;
}

function normalizarBloco(v: Float32Array, off: number, n: number): void {
  let s = 0;
  for (let i = 0; i < n; i++) s += v[off + i]! * v[off + i]!;
  s = Math.sqrt(s);
  if (s < 1e-9) return; // bloco degenerado fica como está
  const inv = 1 / s;
  for (let i = 0; i < n; i++) v[off + i] = v[off + i]! * inv;
}

/**
 * Assina a célula `index` de um batch (N, 3, S, S) em float 0..1.
 *
 * O recorte usa o mesmo `inset` da assinatura por grade — é o que tira a
 * moldura da célula (borda de raridade em cima, barra de quantidade embaixo)
 * antes de descrever o ícone.
 *
 * Retorna o vetor já L2-normalizado, pronto para `cosine`.
 */
export function signatureFromBatchMulti(
  batch: Float32Array,
  batchSize: number,
  index: number,
  inset: { top: number; side: number } = { top: 0.135, side: 0.06 },
  opts: MultiOpts = DEFAULT_MULTI,
): Float32Array {
  const plano = batchSize * batchSize;
  const base = index * 3 * plano;

  const padTop = Math.floor(batchSize * inset.top);
  const padSide = Math.floor(batchSize * inset.side);
  const w = batchSize - 2 * padSide;
  const h = batchSize - padTop - padSide;

  const out = new Float32Array(multiDims(opts));

  if (w < 2 || h < 2 || base + 3 * plano > batch.length) return out;

  const maior = Math.max(...opts.escalas, opts.corGrade);
  const rp = new Float32Array(w * h);
  const gp = new Float32Array(w * h);
  const bp = new Float32Array(w * h);

  let k = 0;
  for (let y = 0; y < h; y++) {
    const sy = padTop + y;
    if (sy < 0 || sy >= batchSize) continue;
    for (let x = 0; x < w; x++) {
      const sx = padSide + x;
      if (sx < 0 || sx >= batchSize) continue;
      const p = base + sy * batchSize + sx;
      const d = y * w + x;
      rp[d] = batch[p]! * 255;
      gp[d] = batch[p + plano]! * 255;
      bp[d] = batch[p + 2 * plano]! * 255;
    }
  }

  // luminancia uma vez so, evitada por escala
  const lumFull = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lumFull[i] = rp[i]! * SIG_LUMI + gp[i]! * SIG_G + bp[i]! * SIG_B;
  }

  const scratch = new Float32Array(maior * (maior + 1));

  for (const n of opts.escalas) {
    // dHash precisa de (n+1) colunas para comparar n
    reduzir(lumFull, w, h, n + 1, n, scratch);
    k += dHash(scratch, n, out, k);
    normalizarBloco(out, k - n * n, n * n);
  }

  // cor: media de cor, nao luminancia
  const cg = opts.corGrade;
  for (let ch = 0; ch < 3; ch++) {
    const src = ch === 0 ? rp : ch === 1 ? gp : bp;
    reduzir(src, w, h, cg, cg, scratch);
    out[k++] = scratch[0]! / 255;
    for (let i = 1; i < cg * cg; i++) out[k++] = scratch[i]! / 255;
  }
  normalizarBloco(out, k - cg * cg * 3, cg * cg * 3);

  // normalização final do conjunto
  let s = 0;
  for (const v of out) s += v * v;
  s = Math.sqrt(s);
  if (s > 1e-9) {
    const inv = 1 / s;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * inv;
  }
  return out;
}
