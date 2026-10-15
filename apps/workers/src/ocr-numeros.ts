import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

import { createWorker, PSM, type Worker } from 'tesseract.js';

import {
  HUD_REGIOES,
  lerContador,
  lerTotalBr,
  regiaoHud,
  type Contador,
  type PapelRegiao,
  type Rect,
} from '@arcgx/shared';

import type { BgraFrame } from './protocol.js';

/**
 * Contadores e total da raid, lidos da tela.
 *
 * ## ## ## Por que Tesseract e nao o motor do Windows
 *
 * O addon `@arcgx/ocr` usava a WinRT e **nunca funcionou**: o `IBuffer` que
 * ele entrega ao motor tem `Length = 0`, entao a imagem nunca chega ao
 * recognizer. Ele devolvia zero palavras em 9,7 ms e sem erro — e o
 * `ocrSupport()` dizia `available: true`, porque so checava se as APIs
 * existem. O app publicava `engine: 'windows'` com 0 palavras como se
 * estivesse saudavel, e todo contador falhava antes de haver parser.
 *
 * ## ## ## Modelo empacotado, nao baixado
 *
 * `resourcesDir/ocr/eng.traineddata.gz` (2,8 MB) vem junto do app. Baixar em
 * runtime quebraria o local-first e o app nao funcionaria offline.
 */
export interface LeituraHud {
  contadores: Record<string, Contador>;
  /** total da raid, ou null quando o recorte nao deu um numero confiavel */
  total: number | null;
  /** texto cru por regiao, para diagnostico */
  bruto: Record<string, string>;
  ms: number;
}

export interface OcrOptions {
  /** raiz de `resources/`, onde fica `_galeria/` */
  resourcesDir: string;
  /** langPath do Tesseract; padrao `resourcesDir/ocr` */
  langDir?: string;
}

/**
 * ## ## ## Por que o texto passa por PNG
 *
 * Em Node o `recognize` quer imagem **codificada** ou caminho. RGBA cru da
 * `Error in findFileFormatStream: truncated file`: o Tesseract tenta adivinhar o
 * formato dos bytes e nao acha cabecalho. No navegador o mesmo `recognize`
 * aceita canvas — e por isso que o exemplo da documentacao funciona la e falha
 * aqui, e o mesmo erro custou duas rodadas.
 *
 * A alternativa seria `sharp`, que o repositorio ja tem como dependencia
 * transitiva. Nao vale: 300 KB de WASM do `sharp` para codificar quatro
 * recorte de 90x30. Sao ~40 linhas e zero dependencia.
 */
function rgbaParaPng(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  return encodePng(rgba, w, h);
}

// Implementacao local: ver `tools/lib/png.mjs`. Duplicada aqui de proposito —
// o worker e compilado pelo `tsc` para `dist/` e nao alcanca `tools/`, que nao
// faz parte do `tsconfig` dele. O encoder tem 40 linhas; uma dependencia de
// runtime para ele seria maior que o codigo.

function crcTable(): Int32Array {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}

let _crc: Int32Array | null = null;

function crc32(buf: Buffer): number {
  const tabela = _crc ?? (crcTable());
  _crc = tabela;
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tabela[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(tipo: string, dados: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, c]);
}

/**
 * `deflateSync` vem de `import` estatico, e nao de `require`: este arquivo
 * compila para ESM (`type: module`), onde `require` nao existe. A primeira
 * versao usou `require('node:zlib')` e a thread morreu com
 * `require is not defined` — que o handler de erro transformou em `null`,
 * entao o sintoma era um HUD vazio sem qualquer pista.
 */
function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Recorta do frame BGRA para RGRA com alpha fixo. */
function recortarRGBA(frame: BgraFrame, r: Rect): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const x0 = Math.max(0, Math.min(frame.width - 1, Math.round(r.x)));
  const y0 = Math.max(0, Math.min(frame.height - 1, Math.round(r.y)));
  const w = Math.max(1, Math.min(frame.width - x0, Math.round(r.width)));
  const h = Math.max(1, Math.min(frame.height - y0, Math.round(r.height)));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    let s = ((y0 + y) * frame.width + x0) * 4;
    let d = y * w * 4;
    for (let x = 0; x < w; x++) {
      out[d] = frame.pixels[s + 2]!;
      out[d + 1] = frame.pixels[s + 1]!;
      out[d + 2] = frame.pixels[s]!;
      out[d + 3] = 255;
      s += 4;
      d += 4;
    }
  }
  return { data: out, width: w, height: h };
}

export class OcrNumeros {
  private worker: Worker | null = null;
  private promessa: Promise<Worker> | null = null;

  /**
   * Ultima leitura **aceita**, por campo.
   *
   * E o candidato da mudanca, para exigir confirmacao.
   *
   * ## ## ## Por que um valor precisa aparecer duas vezes
   *
   * Medido no app rodando, com o inventario aberto e parado:
   *
   *     uso-rapido=4/4  bolso-seguro=1/1  total=null
   *     mochila=6/22    uso-rapido=4/4    bolso-seguro=1/2  total=29484
   *     mochila=6/22    uso-rapido=4/4    bolso-seguro=1/2  total=29484
   *
   * Campos diferentes degradam **juntos**, no mesmo quadro — assinatura de um
   * frame compositado pela metade enquanto a UI anima, nao de erro de leitura.
   * Sem este filtro, o contador do overlay pisca: mostra, some, mostra.
   *
   * O custo e uma leitura de atraso (500 ms a 2 Hz) quando o numero muda de
   * verdade. Troca oscillators por 500 ms de atraso, e nao o contrario.
   */
  private aceito: Record<string, { v: Contador | number | null; r: LeituraHud['contadores'][string] | number | null }> = {};
  private candidato: Record<string, unknown> = {};

  constructor(private readonly opts: OcrOptions) {}

  /**
   * Sobe o worker do Tesseract.
   *
   * `cacheMethod: 'none'` e obrigatorio: o padrao grava o modelo em cache do
   * pacote em disco, e um worker com escrita no filesystem do usuario dentro de
   * um `worker_threads` do app e uma surpresa que ninguem pediu.
   */
  private subir(): Promise<Worker> {
    this.promessa ??= (async () => {
      const langDir = this.opts.langDir ?? path.join(this.opts.resourcesDir, 'ocr');
      const traineddata = path.join(langDir, 'eng.traineddata.gz');
      // Falhar aqui e dito, nao engolido: um `eng.traineddata.gz` ausente
      // significa que a release foi montada sem ele, e o app vai ler zero
      // em tudo sem dizer por que.
      await readFile(traineddata).catch(() => {
        throw new Error(
          `OCR sem modelo: ${traineddata} nao existe.\n` +
            `  copie de node_modules/@tesseract.js-data/eng/4.0.0_best_int/`,
        );
      });

      const w = await createWorker('eng', 1, {
        langPath: langDir,
        cacheMethod: 'none',
        logger: () => {},
      });

      /**
       * Whitelist: so o que existe nesses campos.
       *
       * Sem ela o motor "le" letra onde nao tem nada e devolve com confianca
       * alta — o pior formato de falha, porque parece confiavel.
       */
      await w.setParameters({
        tessedit_char_whitelist: '0123456789/.,',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        preserve_interword_spaces: '0',
      });
      return w;
    })();
    return this.promessa;
  }

  /** Le os contadores e o total. */
  async ler(frame: BgraFrame): Promise<LeituraHud> {
    const t0 = performance.now();
    const w = await this.subir();

    const bruto: Record<string, string> = {};
    /** leitura crua desta vez, ainda sem o filtro de estabilidade */
    const cru: Record<string, Contador | number | null> = {};

    for (const spec of HUD_REGIOES) {
      const rect = regiaoHud(spec, frame.width, frame.height);
      if (
        rect.x < 0 ||
        rect.y < 0 ||
        rect.x + rect.width > frame.width ||
        rect.y + rect.height > frame.height
      ) {
        // Regiao fora do frame: em resolucao menor que 1080 o total, que e
        // absoluto, pode sair da tela. Isso nao e erro, e so nao ha o que ler.
        continue;
      }

      const img = recortarRGBA(frame, rect);
      const buf = rgbaParaPng(img.data, img.width, img.height);
      const { data } = await w.recognize(buf);
      const texto = (data.text ?? '').trim().replace(/\s+/g, '');
      bruto[spec.id] = texto;

      if (spec.papel === 'contador' satisfies PapelRegiao) {
        cru[spec.id] = lerContador(texto);
      } else {
        cru[spec.id] = lerTotalBr(texto);
      }
    }

    const saida = this.estabilizar(cru, bruto, performance.now() - t0);
    return saida;
  }

  /**
   * Exige confirmacao: um valor so entra quando bate com a leitura anterior, ou
   * quando repete o candidato pendente.
   *
   * Devolve **todas** as regioes que estao estaveis agora — inclusive as que
   * nao mudaram. O filtro e sobre a aceitacao de uma mudanca, nao sobre a
   * presenca do dado.
   */
  private estabilizar(
    cru: Record<string, Contador | number | null>,
    bruto: Record<string, string>,
    ms: number,
  ): LeituraHud {
    const contadores: Record<string, Contador> = {};
    let total: number | null = null;

    for (const [id, novo] of Object.entries(cru)) {
      const anterior = this.aceito[id]?.r ?? null;

      /**
       * `null` e "nao deu para ler", nao "leu zero".
       *
       * Sem esta guarda, um `null` transitório — de um frame pela metade —
       * virava candidato, o `null` seguinte batia com ele, e o valor bom era
       * **apagado**. Era o que fazia `mochila=6/22` sumir da barra por quadros
       * seguidos enquanto `total` continuava firme.
       *
       * O jogo sempre escreve `x/y` num contêiner e sempre escreve o total.
       * `null` significa recorte errado ou frame em transicao, nunca "zero".
       */
      if (novo === null) {
        this.aceito[id] = { v: anterior, r: anterior };
        continue;
      }

      const mesmo = JSON.stringify(novo) === JSON.stringify(anterior);
      const repetiuCandidato =
        this.candidato[id] !== undefined &&
        JSON.stringify(novo) === JSON.stringify(this.candidato[id]);

      let valor: Contador | number | null;
      if (mesmo) {
        valor = anterior;
        delete this.candidato[id];
      } else if (repetiuCandidato) {
        // Confirmado: o numero mudou mesmo, e nao foi frame pela metade.
        valor = novo;
        delete this.candidato[id];
      } else {
        // Primeira aparição: fica pendente. Fica valendo a leitura anterior.
        this.candidato[id] = novo;
        valor = anterior;
      }

      this.aceito[id] = { v: valor, r: valor };

      if (typeof valor === 'number') total = valor;
      else if (valor && typeof valor === 'object' && 'ocupado' in valor) {
        contadores[id] = valor as Contador;
      }
    }

    return { contadores, total, bruto, ms };
  }

  async dispose(): Promise<void> {
    try {
      await this.worker?.terminate();
    } catch {
      /* ja encerrado */
    }
    this.worker = null;
    this.promessa = null;
  }
}