import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Rect } from '@arcgx/shared';

export interface WorkerInit {
  kind: 'scan' | 'ocr' | 'ocr-numeros' | 'map';
  modelsDir: string;
  /**
   * Raiz de `resources/` — onde fica `_galeria/`.
   *
   * Separado de `modelsDir` porque os dois se confundiram: o dHash lia
   * `models/gallery.json` e a galeria de embeddings vive em
   * `apps/main/resources/_galeria/`. Ausente, o worker procura em `modelsDir`.
   */
  resourcesDir?: string;
  provider?: 'auto' | 'cpu';
  threads?: number;
}

/**
 * Frame do Windows Graphics Capture.
 *
 * BGRA, 4 bytes por pixel, row-major. **Não RGBA.**
 *
 * A ordem não é um detalhe: o `cell-vision` calcula luma com 0.2126 no
 * TERCEIRO canal (`luma(b, g, r)`), e o classificador compara a assinatura
 * com pesos de R e B distintos. Entregar os canais trocados não dá erro — dá
 * detecção de borda degradada e casamento errado, silenciosamente.
 *
 * BGRA é o que o D3D11 entrega; converter para RGBA aqui seria trabalho inútil
 * custando uma cópia de 8 MB por frame.
 */
export interface BgraFrame {
  width: number;
  height: number;
  /** BGRA, 4 bytes por pixel, row-major. */
  pixels: Uint8Array;
}

export interface ScanRequest {
  type: 'scan';
  frame: BgraFrame;
  /**
   * Uma região a varrer, com a grade ja medida.
   *
   * Vários painéis num request só, não um request por painel: o frame tem
   * 8 MB e o `postMessage` copia. Cinco painéis em cinco requests seriam
   * 40 MB por tique, a 4 Hz — mais bandwidth que a inferencia.
   */
  regioes: ScanRegiao[];
  roi: Rect;
  /** pedido por deteccao automatica; ignorado se o detector achar a grade */
  gridCols: number;
  gridRows: number;
  /**
   * Retangulos exatos das celulas, ja em coordenadas do frame.
   *
   * Quando vem preenchido, o worker **nao** tenta descobrir a grade: recorta
   * estes retangulos e codifica. A geometria do painel e fixa e medida, e o
   * detector por pixels errou o MOCHILA como 5x7 numa captura real — devolvendo
   * 35 celulas de 83x74 px num painel de 4x5, com `fallback: false` e sem
   * nenhum aviso. Inferir o que ja se sabe so troca precisao por risco.
   *
   * Ausente, o worker cai no detector nativo (comportamento antigo).
   */
  cells?: Rect[];
  /** recorta 14 px do topo da celula — calibrado, ver tools/calib-crop.mjs */
  cellInsetTop?: number;
  /**
   * Onde rodar o OCR. Ausente = o frame inteiro.
   *
   * Tela cheia custa ~180 ms contra ~70 ms só no painel, e é o frame inteiro
   * que traz o texto que dá contexto — "ARMAZENAMENTO", "MOCHILA" e "uso" vêm
   * de lugares diferentes. Por isso o padrão é o frame inteiro; quem tiver
   * CPU apertada pode passar só o `roi`.
   */
  ocrRoi?: Rect;
  /**
   * Pede a leitura dos contadores e do total neste quadro.
   *
   * Quem decide a cadencia e o main (`ScanLoop.intervaloOcrMs`, 2 Hz). O campo
   * substitui `ocrRoi`: o recorte nao vem mais do main porque quem escolhe a
   * regiao agora e o leitor, em `packages/shared/src/hud.ts`.
   */
  querOcr?: boolean;
}

export interface OcrRequest {
  type: 'ocr';
  frame: BgraFrame;
  language?: string;
}

export interface ConfigureRequest {
  type: 'configure';
  provider: 'auto' | 'cpu';
}

export type WorkerRequest =
  | ({ id: number } & ScanRequest)
  | ({ id: number } & OcrRequest)
  | ({ id: number } & ConfigureRequest);

export type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: string };

/**
 * Um painel a varrer.
 *
 * `id` volta em cada celula, porque o overlay precisa saber **qual slot** e de
 * qual contêiner — sem isso, o indice 3 da mochila e o indice 3 do
 * ARMAZENAMENTO viram o mesmo badge.
 */
export interface ScanRegiao {
  id: string;
  rect: Rect;
  cols: number;
  rows: number;
  /** retangulo de cada celula, em coordenadas do frame */
  cells: Rect[];
}

export interface ScanCell {
  /** índice global, único entre todas as regiões */
  index: number;
  /** painel a que esta celula pertence */
  regiao: string;
  /** retangulo em coordenadas do frame */
  rect: Rect;
  /** item casado, ou null quando a nota/margem nao pasa no corte */
  itemId: string | null;
  score: number;
  runnerUp: string | null;
  /**
   * Item sem o sufixo de nível, quando o encoder tem certeza da família.
   *
   * Existe separado do `itemId` porque 34 das 36 famílias do catálogo têm
   * variantes de nível com **a mesma arte**: o embedding identifica o item,
   * mas o III/IV/IV-V só sai lendo o numeral romano que a moldura mascara.
   * O overlay mostra a família e deixa o nível para o leitor de numeral.
   */
  familia?: string | null;
  /** true quando `itemId` é uma das variantes de nível de `familia` */
  levelVariant?: boolean;
}

export interface TextBox {
  text: string;
  /** retangulo em coordenadas do frame (não do recorte de OCR) */
  rect: Rect;
  confidence: number;
}

export interface ScanPayload {
  cells: ScanCell[];
  /** grade detectada, quando o detector acha */
  grid: { cols: number; rows: number } | null;
  ms: number;
  /** true quando a deteccao caiu no fallback de grade fixa */
  fallback: boolean;
  /**
   * Quantas células receberam item.
   *
   * Existe porque "0 classificados" e "0 células" são coisas muito diferentes,
   * e só o primeiro é falha. Sem este campo o painel mostra uma grade correta
   * com tudo em branco e parece que o app funciona.
   */
  classified: number;
  /**
   * Quem casou os itens: `encoder` = galeria de embeddings, `dhash` = fallback.
   *
   * Sem isto, um app que so volta dHash silenciosamente parece funcionar —
   * e o dHash tem 38% de acerto contra 63% do encoder, com erros que o
   * usuario lê como "o app errou o item".
   */
  via?: 'encoder' | 'dhash' | 'nenhum';
  /** painel principal, o que a grade `grid` descreve */
  painel?: string | null;
  /**
   * Contadores e total lidos do cabecalho do jogo.
   *
   * Ausente quando este quadro nao pediu OCR — que e a maioria, porque a
   * leitura roda a 2 Hz e o scan a 30. O overlay tem de tratar "ausente" como
   * "ainda nao leu", e nao como "leu zero": mostrar 0/0 num slot que tem item
   * e pior do que nao mostrar nada.
   */
  hud?: {
    contadores: Record<string, { ocupado: number; capacidade: number }>;
    total: number | null;
    ms: number;
    /** true quando a thread de OCR nao respondeu */
    indisponivel?: boolean;
  };
  /** palavras reconhecidas; ausente quando o OCR está desligado ou indisponível */
  ocr?: {
    boxes: TextBox[];
    engine: 'windows';
    text: string;
    ms: number;
    /** preenchido quando o Windows não tem motor pronto */
    unavailable?: string;
  };
}