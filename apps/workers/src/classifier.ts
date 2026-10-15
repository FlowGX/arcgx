/**
 * Classificador de itens — Fase 4a (template matching).
 *
 * Recebe o batch do `cell-vision` (N, 3, S, S), gera uma assinatura por celula
 * e casa contra a galeria de icones de referencia.
 *
 * ## Politica de "nao sei"
 *
 * Quando a melhor correspondencia fica abaixo de `minScore`, ou quando o
 * segundo colocado chega perto demais (`minMargin`), devolvemos `null`.
 *
 * Isso e deliberado. Blueprint e a arma base tem icone identico
 * (`aphelion` == `aphelion_blueprint`), e um classificador que chuta entre eles
 * produz avaliacao de stash errada justo nos itens caros. Chut errado e pior
 * que nao saber — e o `null` alimenta o fluxo de correcao da comunidade.
 */

import {
  cosine,
  signatureFromBatchMulti,
  decodeSignature,
  matchSignature,
  prepareGallery,
  type Gallery,
  type Match,
} from '@arcgx/shared';

export interface CellDetection {
  index: number;
  itemId: string | null;
  /** 0..1 — 0 quando desconhecido */
  confidence: number;
  runnerUp: string | null;
  /** true quando o icone existe na galeria mas o par era ambiguo */
  ambiguous: boolean;
}

export interface ClassifierOptions {
  minScore: number;
  minMargin: number;
}

/**
 * Limiares medidos contra captura real, não escolhidos no olho.
 *
 * A assinatura é **multiescala** (dHash 8×8 + 16×16 + cor 4×4), e por isso
 * a nota não é comparável com a da grade 12×12: dHash é invariante a brilho e
 * a nota média fica em 0,79 onde a grade chega a 0,94 — sendo a multiescala a
 * **melhor** das duas em margem (0,0128 contra 0,0052).
 *
 * Reprovar por `nota >= 0.90` aqui reprovaria tudo. O que separa mesmo é a
 * margem. Medido nas mesmas 20 células:
 *
 * ```text
 *   limiar de margem   multiescala   grade 12x12
 *   0.010                  8/20          1/20
 *   0.015                  4/20          0/20
 *   0.020                  2/20          0/20
 * ```
 *
 * 0,90 com margem 0,005 era o par da assinatura antiga e rendia 3/20.
 */
export const DEFAULT_OPTIONS: ClassifierOptions = {
  minScore: 0.7,
  minMargin: 0.01,
};

export class ItemClassifier {
  private index: ReturnType<typeof prepareGallery> | null = null;

  constructor(private readonly options: ClassifierOptions = DEFAULT_OPTIONS) {}

  get ready(): boolean {
    return this.index !== null;
  }

  get size(): number {
    return this.index?.ids.length ?? 0;
  }

  load(gallery: Gallery): void {
    this.index = prepareGallery(gallery);
  }

  /** Casa uma celula (ja em 12x12 RGB 0..255) contra a galeria. */
  matchCell(signature: Float32Array): CellDetection {
    if (!this.index) {
      return { index: -1, itemId: null, confidence: 0, runnerUp: null, ambiguous: false };
    }

    const m = matchSignature(this.index, signature, this.options);

    if (!m) {
      return {
        index: -1,
        itemId: null,
        confidence: 0,
        runnerUp: null,
        ambiguous: true,
      };
    }

    return toDetection(m, this.options);
  }

  /** Top-1 e top-2 crus, para medir limiar com dado em vez de palpite. */
  scoreCell(signature: Float32Array): { top: string; score: number; second: number } | null {
    if (!this.index) return null;
    let best = -1;
    let bestId = '';
    let second = -1;
    for (const id of this.index.ids) {
      const s = cosine(signature, this.sig(id));
      if (s > best) {
        second = best;
        best = s;
        bestId = id;
      } else if (s > second) {
        second = s;
      }
    }
    return { top: bestId, score: best, second: second < 0 ? 0 : second };
  }

  private sig(id: string): Float32Array {
    let v = this.index!.cache.get(id);
    if (!v) {
      v = decodeSignature(this.index!.items[id]!);
      this.index!.cache.set(id, v);
    }
    return v;
  }

  /**
   * Classifica todas as celulas de um batch do cell-vision.
   *
   * @param batch  (N, 3, S, S) float 0..1, como devolvido pelo addon
   */
  matchBatch(batch: Float32Array, batchSize: number, count: number): CellDetection[] {
    const out: CellDetection[] = [];
    for (let i = 0; i < count; i++) {
      const sig = signatureFromBatchMulti(batch, batchSize, i);
      const d = this.matchCell(sig);
      out.push({ ...d, index: i });
    }
    return out;
  }
}

function toDetection(m: Match, options: ClassifierOptions): CellDetection {
  return {
    index: -1,
    itemId: m.itemId,
    confidence: Math.min(1, Math.max(0, m.score)),
    runnerUp: m.runnerUp,
    ambiguous: m.score - m.runnerUpScore < options.minMargin * 2,
  };
}