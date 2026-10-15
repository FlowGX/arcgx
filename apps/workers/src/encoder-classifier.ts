/**
 * Classificador por embedding — o caminho que roda no app.
 *
 * ## ## ## Por que isto substitui o dHash
 *
 * `classifier.ts` (Fase 4a) gerava uma assinatura multiescala dHash por celula
 * e casava contra icones de referencia de 12x12. A sonda mostrou o que isso
 * custava: crops de itens **diferentes** davam coseno 0,398 — maior que o do
 * par certo, 0,286. O encoder lia a moldura em vez do objeto, e o
 * `minMargin` de 0,01 nunca separava nada de util.
 *
 * O encoder treinado em `ml/treinar-arte.py` resolve com:
 *
 *     recall@1  63,0%   (224x224, sem nenhum rotulo)
 *     latencia  15,61 ms por grade de 20 celulas
 *
 * ## ## ## ## A galeria e estatica e vai pre-calculada
 *
 * `tools/exportar-galeria.py` grava `galeria.bin` (1,16 MB) com os 1.106
 * embeddings ja normalizados, e `encoder.onnx` ao lado. Codificar a arte a
 * cada quadro seria desperdicio: o catalogo nao muda.
 *
 * O manifesto tem um `espaco` = `model-<sha256[:12]>`, a mesma ideia do
 * `spaceId` do ARC Tracker: trocar o modelo invalida a galeria, e isso precisa
 * ser **detectavel**, nao silencioso.
 *
 * ## ## ## Sem YOLO e sem cell-vision
 *
 * Nem o ARC Tracker nem a nossa captura precisam detectar a grade aqui. A
 * geometria esta medida em `scan/panels.ts`, entao as celulas sao aritmetica
 * sobre o frame. O YOLO deles custa a maior parte do orcamento de 80 ms; aqui
 * custa zero.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as ort from 'onnxruntime-node';

/** Media e desvio do ImageNet — o mesmo do `ml/encoder_comum.py`. */
const MEDIA = [0.485, 0.456, 0.406] as const;
const DESVIO = [0.229, 0.224, 0.225] as const;

export interface GalleryManifest {
  itens: number;
  dim: number;
  lado: number;
  normalizado: 'l2';
  espaco: string;
  /** sha256 do `.pt` que gerou os vetores — e a fonte do `espaco` */
  sha256: string;
  /** sha256 do `.onnx` entregue ao app; ausente em galerias antigas */
  sha256_onnx?: string;
  encoder?: string;
  origem: string;
  rotulos: number;
}

/** Uma celula recortada do frame: BGRA, row-major. */
export interface CellImage {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export interface Hit {
  itemId: string;
  score: number;
}

export interface SearchResult extends Hit {
  /** segundo colocado — a margem entre top-1 e top-2 é o que diz "não sei" */
  runnerUp: string | null;
  runnerUpScore: number;
  /** true quando top-1 e top-2 estão perto demais para afirmar */
  ambiguous: boolean;
  /**
   * Item sem o sufixo de nível: `torrente-iv` -> `torrente`.
   *
   * 34 das 36 famílias do catálogo têm mais de um nível e **compartilham a
   * mesma arte** — muda só o numeral romano no canto da célula. O embedding
   * não tem como separar III de IV, e fingir que tem produz `ambiguous` no
   * item certo: `torrente-iv` a 0,566 contra `torrente-iii` a 0,53.
   *
   * O encoder responde "é um torrente"; o nível sai do leitor de numeral
   * (`ml/nivel.py`), que enxerga justamente a parte que o encoder mascara.
   */
  familia: string;
  /** true quando o top-1 é uma variante de nível da família já identificada */
  levelVariant: boolean;
  /** false quando a similaridade absoluta está abaixo de `minScore` */
  confiavel: boolean;
}

export interface EncoderClassifierOptions {
  /**
   * Corte de similaridade do top-1.
   *
   * ## Por que 0,55 e nao o 0,70 antigo
   *
   * O 0,70 foi medido no encoder **de 112 px**: a mediana do vizinho mais
   * proximo era 0,685. O encoder de 224 px, sem rotulos, pontua mais baixo —
   * nas 9 celulas reais da mochila deu 0,584 a 0,616 nos 6 acertos e 0,319 e
   * 0,437 nos 2 duvidosos. Um corte em 0,70 reprovaria **todos** os acertos e
   * o app mostraria "desconhecido" em slot que tem item.
   *
   * 0,55 separa os grupos medidos, mas e provisorio: vale recalibrar com o
   * gabarito de `tools/testar-classificador.mjs`, que ainda esta vazio.
   */
  minScore: number;
  /**
   * Margem minima entre top-1 e top-2, **considerando apenas familias
   * diferentes** — ver o comentario em `search`.
   */
  minMargin: number;
}

export const DEFAULT_OPTIONS: EncoderClassifierOptions = {
  minScore: 0.55,
  minMargin: 0.04,
};

export class EncoderClassifier {
  private session: ort.InferenceSession | null = null;
  private vectors: Float32Array | null = null;
  private ids: string[] = [];
  private manifest: GalleryManifest | null = null;
  private familias: Map<string, string> = new Map();

  private constructor(
    private readonly opts: EncoderClassifierOptions = DEFAULT_OPTIONS,
  ) {}

  static async create(
    resourcesDir: string,
    opts: EncoderClassifierOptions = DEFAULT_OPTIONS,
  ): Promise<EncoderClassifier> {
    const dir = path.join(resourcesDir, '_galeria');
    const c = new EncoderClassifier(opts);

    const manifest = JSON.parse(
      await readFile(path.join(dir, 'manifesto.json'), 'utf-8'),
    ) as GalleryManifest;
    c.manifest = manifest;

    const bin = await readFile(path.join(dir, 'galeria.bin'));
    c.ids = unpackGallery(bin, manifest);
    c.vectors = _cacheGaleria;
    c.familias = montarFamilias(c.ids);

    const onnxPath = path.join(dir, 'encoder.onnx');
    const onnx = await readFile(onnxPath);

    /* O galeria.bin e o encoder.onnx precisam vir do mesmo treino. Sem esta
     * verificacao o app carrega um par inconsistente e devolve ~0,14 de
     * similaridade em vez de ~1,00 — sem erro, sem aviso, so o item errado
     * no overlay. O manifesto guarda os dois sha; qualquer um que nao bata
     * significa galeria trocada ou export antigo. */
    const esperado = manifest.sha256_onnx;
    if (esperado) {
      const real = createHash('sha256').update(onnx).digest('hex');
      if (real !== esperado) {
        throw new Error(
          `encoder.onnx nao bate com a galeria.\n` +
            `  esperado ${esperado.slice(0, 12)}  encontrado ${real.slice(0, 12)}\n` +
            `  reexporte: python tools/exportar-galeria.py`,
        );
      }
    }

    c.session = await ort.InferenceSession.create(onnxPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });

    return c;
  }

  get ready(): boolean {
    return this.session !== null && this.vectors !== null;
  }

  get size(): number {
    return this.ids.length;
  }

  get space(): string {
    return this.manifest?.espaco ?? 'desconhecido';
  }

  get lado(): number {
    return this.manifest?.lado ?? 224;
  }

  /**
   * Codifica um lote de celulas em um so `run`.
   *
   * Bolar e o que paga a conta: `tools/medir-224.py` mediu 2,20 ms por
   * recorte chamada isolada e **15,61 ms** para 20 num lote so — 0,78 ms por
   * celula. Sao 20 sessoes de runtime em vez de uma.
   */
  async embed(cells: CellImage[]): Promise<Float32Array> {
    if (!this.session) throw new Error('encoder nao carregado');
    const n = cells.length;
    const L = this.lado;
    const dado = new Float32Array(n * 3 * L * L);
    for (let i = 0; i < n; i++) {
      const c = cells[i]!;
      // [n, 3, L, L]
      celulaParaNchw(c.pixels, c.width, c.height, dado, i * 3 * L * L, L);
    }
    const tensor = new ort.Tensor('float32', dado, [n, 3, L, L]);
    const entrada = this.session.inputNames[0] ?? 'entrada';
    const saida = await this.session.run({ [entrada]: tensor });
    const v = saida[this.session.outputNames[0] ?? 'embedding']!.data as Float32Array;
    return new Float32Array(v);
  }

  /**
   * Busca por cosseno. A galeria ja esta normalizada em L2.
   *
   * ## ## ## Por que a margem e o criterio, e nao so a nota
   *
   * `burletta-ii` e `burletta-iv` tem a arte **identica** no catalogo. O
   * encoder pode dar 0,95 para os dois e ainda assim nao saber qual e qual —
   * a nota alta nao prova identidade, prova "este sprite se parece com algum
   * dos que eu conheco".
   *
   * Por isso o segundo colocado e devolvido: e a margem que diz se vale
   * afirmar. E a mesma razao do `minMargin` no dHash, so que aqui a separacao
   * existe de verdade em vez de ser um numero sorteado contra uma assinatura
   * que nao media nada.
   */
  search(embedding: Float32Array): SearchResult {
    const dim = this.manifest!.dim;
    const gal = this.vectors;
    if (!gal) throw new Error('galeria nao carregada');

    let iMelhor = -1;
    let iSegundo = -1;
    let melhor = -Infinity;
    let segundo = -Infinity;

    for (let i = 0; i < this.ids.length; i++) {
      let s = 0;
      const o = i * dim;
      for (let d = 0; d < dim; d++) s += embedding[d]! * gal[o + d]!;
      if (s > melhor) {
        segundo = melhor;
        iSegundo = iMelhor;
        melhor = s;
        iMelhor = i;
      } else if (s > segundo) {
        segundo = s;
        iSegundo = i;
      }
    }

    const id = this.ids[iMelhor]!;
    const idSegundo = iSegundo >= 0 ? this.ids[iSegundo]! : null;
    const familia = this.familias.get(id) ?? id;
    const mesmaFamilia = idSegundo !== null && (this.familias.get(idSegundo) ?? idSegundo) === familia;

    /**
     * A margem so separa familias **quando elas sao diferentes**.
     *
     * `torrente-iv` a 0,566 e `torrente-iii` a 0,53 dao margem 0,03 — abaixo
     * de qualquer limiar razoavel — mas sao o mesmo item com o numeral
     * diferente, e o jogo **sobrescreve** a arte. Julgar "ambiguo" aqui
     * descarta a resposta certa e devolve "desconhecido" num slot que tem
     * item, que e o pior resultado possivel para quem esta vendo o valor.
     *
     * Ja `defibrillator-recipe` contra `integrated-defibrillator` sao familias
     * diferentes com arte parecida: ai a margem pequena significa duvida de
     * verdade, e `null` continua certo.
     */
    const margem = melhor - segundo;
    const confiavel = melhor >= this.opts.minScore;
    return {
      itemId: id,
      score: melhor,
      runnerUp: idSegundo,
      runnerUpScore: segundo,
      ambiguous: !mesmaFamilia && margem < this.opts.minMargin,
      familia,
      levelVariant: familia !== id,
      confiavel,
    };
  }

  /** Reconhece um lote inteiro e devolve um resultado por celula. */
  async recognize(cells: CellImage[]): Promise<SearchResult[]> {
    const e = await this.embed(cells);
    const dim = this.manifest!.dim;
    const out: SearchResult[] = [];
    for (let i = 0; i < cells.length; i++) {
      const slice = e.subarray(i * dim, (i + 1) * dim);
      let n = 0;
      for (let d = 0; d < dim; d++) n += slice[d]! * slice[d]!;
      out.push(this.search(slice));
    }
    return out;
  }
}

let _cacheGaleria: Float32Array | null = null;

/**
 * Monta id -> familia a partir do próprio catálogo, sem adivinhar regex.
 *
 * ## A regra, e por que ela exige **duas** occurrences
 *
 * ARCK numera o nível como sufixo romano: `torrente-i` … `torrente-iv`. A
 * arte é a mesma e muda só o numeral no canto da célula.
 *
 * O detalhe que quebrou a primeira versao: **a base raramente existe como item
 * proprio**. Não há um `torrente` no catálogo, há `torrente-i` a `torrente-iv`.
 * Exigir que a base estivesse na lista deixava todo mundo como família própria
 * e `torrente-iv` vs `torrente-iii` continuava "ambíguo" — exatamente o caso
 * que a regra existe para resolver.
 *
 * Por isso o agrupamento é por base compartilhada, e só vale quando **duas ou
 * mais** entradas caem nela. Com uma só, é um item qualquer que termina em
 * letra romana e não tem familia — e ele fica como família própria.
 */
function montarFamilias(ids: string[]): Map<string, string> {
  const grupos = new Map<string, string[]>();
  for (const id of ids) {
    const corte = id.lastIndexOf('-');
    if (corte <= 0) continue;
    const sufixo = id.slice(corte + 1);
    if (!/^[ivx]+$/.test(sufixo)) continue;
    const base = id.slice(0, corte);
    const membros = grupos.get(base);
    if (membros) membros.push(id);
    else grupos.set(base, [id]);
  }

  const mapa = new Map<string, string>();
  for (const id of ids) mapa.set(id, id);
  for (const [base, membros] of grupos) {
    if (membros.length < 2) continue;
    for (const m of membros) mapa.set(m, base);
  }
  return mapa;
}

function unpackGallery(bin: Uint8Array, manifest: GalleryManifest): string[] {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const magic = String.fromCharCode(bin[0]!, bin[1]!, bin[2]!, bin[3]!);
  if (magic !== 'GXGB') throw new Error(`galeria.bin invalido (magic "${magic}")`);
  const itens = dv.getUint32(4, true);
  const dim = dv.getUint32(8, true);
  const idsLen = dv.getUint32(12, true);
  const ids = JSON.parse(
    new TextDecoder().decode(bin.subarray(16, 16 + idsLen)),
  ) as string[];
  if (itens !== manifest.itens || dim !== manifest.dim) {
    throw new Error(
      `galeria.bin (${itens}x${dim}) nao bate com manifesto.json ` +
        `(${manifest.itens}x${manifest.dim}) — regerere com tools/exportar-galeria.py`,
    );
  }
  const dados = bin.subarray(16 + idsLen);
  /**
   * ## Por que copiar em vez de usar `dados.buffer` direto
   *
   * `new Float32Array(buffer, byteOffset, len)` exige que `byteOffset` seja
   * multiplo de 4. O `Buffer` do Node le `galeria.bin` num offset que
   * depende do tamanho do cabecalho (16 + idsLen), e `idsLen` nao e multiplo
   * de 4 — o resultado e `RangeError: start offset of Float32Array should be
   * a multiple of 4`.
   *
   * A copia custa 1,1 MB uma vez, no arranque. A alternativa seria alinhar o
   * cabecalho, o que amarra o formato ao item mais curto do catalogo.
   */
  const copiado = dados.buffer.slice(
    dados.byteOffset,
    dados.byteOffset + dados.byteLength,
  );
  _cacheGaleria = new Float32Array(copiado, 0, itens * dim);
  return ids;
}

/**
 * Celula BGRA 92x104 -> tensor NCHW normalizado.
 *
 * ## Por que bilinear na mao
 *
 * Nao ha `sharp` nem `jimp` no monorepo, e adicionar uma dependencia nativa
 * para um resize de 92x104 -> 224x224 seria desproporcional. O bilinear em
 * JS custa ~50k operacoes por celula, o que e ruido perto dos 0,78 ms de
 * inferencia.
 *
 * ## ## Por que BGRA e nao RGBA
 *
 * O D3D11 entrega BGRA e o `cell-vision` calcula luma no TERCEIRO canal.
 * Trocar os canais aqui nao da erro: da deteccao degradada e casamento
 * errado, em silencio.
 */
/**
 * Celula BGRA 92x104 -> tensor NCHW normalizado, com **bilinear**.
 *
 * ## ## ## Por que bilinear e nao nearest
 *
 * A primeira versao fazia `Math.round(x * passo)`, que e nearest. Num
 * upscale de 92x104 para 224x224 o nearest joga fora a maior parte dos
 * pixels de origem e produz serrilha em diagonal — e o modelo foi treinado
 * com `LANCZOS`, nunca viu aquela imagem. O sintoma nao era erro: era
 * similaridade de **0,18** contra 0,62 do Python, com o mesmo `.onnx` e a
 * mesma `galeria.bin`.
 *
 * ## ## Por que BGRA e nao RGBA
 *
 * O D3D11 entrega BGRA e o `cell-vision` calcula luma no TERCEIRO canal.
 * Trocar os canais aqui nao da erro: da deteccao degradada e casamento
 * errado, em silencio.
 *
 * ## ## ## Por que o crop entra **sem** enquadrar
 *
 * `ml/raid.py` passa por `moldura.enquadrar_recorte` antes de codificar; o
 * Node nao tem esse passo. A diferenca e pequena (a barra de baixo da
 * celula), e o modelo foi treino com augmentacao sobre a arte ja enquadrada.
 * Se a divergencia persistir depois do bilinear, este e o proximo candidato —
 * e vale medir antes de "consertar", porque os dois lados precisam da mesma
 * receita, nao da mesma aparencia.
 */
/**
 * ## ## ## Por que BGRA e nao RGBA
 *
 * O D3D11 entrega BGRA e o `cell-vision` calcula luma no TERCEIRO canal.
 * Trocar os canais aqui nao da erro: da deteccao degradada e casamento
 * errado, em silencio.
 *
 * ## ## ## Por que a barra e neutralizada
 *
 * `ml/raid.py` passa por `moldura.enquadrar_recorte` antes de codificar e o
 * Node nao fazia esse passo. Medido no frame real: os scores do Node ficavam
 * 0,03 a 0,06 abaixo dos do Python nas mesmas celulas — `rubber-parts-recipe`
 * 0,795 contra 0,801, `light-ammo` 0,709 contra 0,762. Diferenca pequena,
 * systematicamente para baixo, e que **`ambiguous` sente**: a chave de
 * Stella Montis a 0,730 perdeu a margem e virou `null`.
 *
 * A receita e a de `ml/moldura.py`: a faixa da barra (linhas 86..104) quase
 * uniforme, e as duas regions que carregam icone de tipo e quantidade
 * recebem a mediana da propria faixa. A barra e ruido para o encoder — o que
 * importa no slot e o item, e a mesma mascara vale para arte e para recorte.
 *
 * Aplicar dentro do amostrador, em vez de copiar o recorte para neutralizar,
 * evita uma copia de 38 KB por celula e por quadro.
 */
const MEDIA_T = [0.485, 0.456, 0.406] as const;
const DESVIO_T = [0.229, 0.224, 0.225] as const;

/** Medidas em `ml/moldura.py`, como fracao para sobreviver a outro recorte. */
const BARRA_Y = 86 / 104;
const BARRA_ICONE: readonly [number, number] = [0 / 92, 19 / 92];
const BARRA_QUANT: readonly [number, number] = [56 / 92, 92 / 92];

/**
 * Mediana por canal da faixa da barra.
 *
 * Os valores sao uint8, entao cabe num histograma de 256 — O(n) e sem ordenar
 * tres vetores de ~1.700 elementos por celula. `Array.sort` aqui custaria
 * mais que todo o resto do preprocessamento somado.
 */
function medianaBarra(
  bgra: Uint8Array,
  largura: number,
  altura: number,
): Float32Array {
  const y0 = Math.round(BARRA_Y * altura);
  const out = new Float32Array(3);
  const h = new Uint32Array(256);
  for (let c = 0; c < 3; c++) {
    h.fill(0);
    let total = 0;
    for (let y = y0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        h[bgra[(y * largura + x) * 4 + (2 - c)]!]!++;
        total++;
      }
    }
    let acc = 0;
    let med = 0;
    for (let v = 0; v < 256; v++) {
      acc += h[v]!;
      if (acc * 2 >= total) {
        med = v;
        break;
      }
    }
    out[c] = med;
  }
  return out;
}

/**
 * Mapeamento de saida -> origem, memoizado por geometria.
 *
 * ## ## ## Por que cachear
 *
 * Toda celula do jogo tem 92x104 e o modelo e 224x224. As posicoes de origem
 * de cada pixel de saida sao sempre as mesmas, e recalcular `Math.floor` e as
 * quatro divisoes a cada pixel era o grosso dos 23 ms restantes: 8 celulas
 * geram 4,8 milhoes de踏 passos, todos identicos.
 *
 * Guardar os indices e os pesos por `(largura, altura, L)` tira a aritmetica
 * do laco interno. Como so existe uma geometria no app, o cache tem uma
 * entrada na pratica.
 */
interface MapaAmostra {
  x0: Int32Array;
  x1: Int32Array;
  wA: Float32Array;
  wB: Float32Array;
  wC: Float32Array;
  wD: Float32Array;
  y0: Int32Array;
  y1: Int32Array;
  py0: Int32Array;
  py1: Int32Array;
}

const _mapaCache = new Map<string, MapaAmostra>();

function mapaAmostra(largura: number, altura: number, L: number): MapaAmostra {
  const chave = `${largura}x${altura}x${L}`;
  const ja = _mapaCache.get(chave);
  if (ja) return ja;

  const x0 = new Int32Array(L);
  const x1 = new Int32Array(L);
  const wA = new Float32Array(L);
  const wB = new Float32Array(L);
  const wC = new Float32Array(L);
  const wD = new Float32Array(L);
  for (let x = 0; x < L; x++) {
    const fx = (x * (largura - 1)) / (L - 1);
    const a = Math.floor(fx);
    const b = Math.min(largura - 1, a + 1);
    const wx = fx - a;
    x0[x] = a;
    x1[x] = b;
    wA[x] = (1 - wx);
    wB[x] = wx;
    wC[x] = 1 - wx;
    wD[x] = wx;
  }

  const y0 = new Int32Array(L);
  const y1 = new Int32Array(L);
  const py0 = new Int32Array(L);
  const py1 = new Int32Array(L);
  for (let y = 0; y < L; y++) {
    const fy = (y * (altura - 1)) / (L - 1);
    const a = Math.floor(fy);
    const b = Math.min(altura - 1, a + 1);
    y0[y] = a;
    y1[y] = b;
    py0[y] = a * largura;
    py1[y] = b * largura;
  }

  const m: MapaAmostra = { x0, x1, wA, wB, wC, wD, y0, y1, py0, py1 };
  _mapaCache.set(chave, m);
  return m;
}

export function celulaParaNchw(
  bgra: Uint8Array,
  largura: number,
  altura: number,
  destino: Float32Array,
  base: number,
  L = 224,
): void {
  const plano = L * L;
  const mediana = medianaBarra(bgra, largura, altura);
  const yBarra = Math.round(BARRA_Y * altura);
  const xIcone0 = Math.round(BARRA_ICONE[0] * largura);
  const xIcone1 = Math.round(BARRA_ICONE[1] * largura);
  const xQuant0 = Math.round(BARRA_QUANT[0] * largura);
  const xQuant1 = Math.round(BARRA_QUANT[1] * largura);

  /**
   * Mascara por pixel de origem, resolvida **uma vez** por celula.
   *
   * A primeira versao chamava uma funcao `amostra()` para cada um dos 4 taps
   * de cada pixel de saida: 4,8 milhoes de chamadas para 8 celulas, e o
   * preprocessamento sozinho levava 58,5 ms — mais que o ONNX e a busca juntos.
   * Uma tabela de 92x104 bytes troca cada comparacao por um acesso.
   *
   * As linhas de saida que ficam inteiras acima da barra nem consultam a
   * tabela: sao ~83% dos pixels, e o ramo e previsivel.
   */
  const temBarra = yBarra < altura;
  const mascara = temBarra ? new Uint8Array(largura * altura) : null;
  if (mascara) {
    for (let y = yBarra; y < altura; y++) {
      for (let x = xIcone0; x < xIcone1; x++) mascara[y * largura + x] = 1;
      for (let x = xQuant0; x < xQuant1 && x < largura; x++) mascara[y * largura + x] = 1;
    }
  }

  const m = mapaAmostra(largura, altura, L);
  const limiarBarra = yBarra * largura;

  for (let y = 0; y < L; y++) {
    const wy = (y * (altura - 1)) / (L - 1) - m.y0[y]!;
    const a0 = m.py0[y]!;
    const a1 = m.py1[y]!;
    const soBarra = mascara !== null && (a0 >= limiarBarra || a1 >= limiarBarra);
    const iwy = 1 - wy;
    const linha = y * L;

    for (let x = 0; x < L; x++) {
      const xa = m.x0[x]!;
      const xb = m.x1[x]!;
      const wx = m.wB[x]!;
      const iwx = m.wA[x]!;
      const w00 = iwy * iwx;
      const w01 = iwy * wx;
      const w10 = wy * iwx;
      const w11 = wy * wx;
      const o = linha + x;
      const i00 = (a0 + xa) * 4;
      const i01 = (a0 + xb) * 4;
      const i10 = (a1 + xa) * 4;
      const i11 = (a1 + xb) * 4;
      const m00 = soBarra && mascara![a0 + xa] === 1;
      const m01 = soBarra && mascara![a0 + xb] === 1;
      const m10 = soBarra && mascara![a1 + xa] === 1;
      const m11 = soBarra && mascara![a1 + xb] === 1;

      for (let c = 0; c < 3; c++) {
        const canal = 2 - c; // BGRA -> RGB
        const med = mediana[c]!;
        const v00 = m00 ? med : bgra[i00 + canal]!;
        const v01 = m01 ? med : bgra[i01 + canal]!;
        const v10 = m10 ? med : bgra[i10 + canal]!;
        const v11 = m11 ? med : bgra[i11 + canal]!;
        const v = v00 * w00 + v01 * w01 + v10 * w10 + v11 * w11;
        destino[base + c * plano + o] = (v / 255 - MEDIA_T[c]!) / DESVIO_T[c]!;
      }
    }
  }
}
