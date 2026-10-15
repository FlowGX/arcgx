import { parentPort, workerData } from 'node:worker_threads';

import type { BgraFrame } from './protocol.js';
import { OcrNumeros } from './ocr-numeros.js';

/**
 * Thread dedicada ao OCR de numeros.
 *
 * ## ## ## Por que uma thread so para isso
 *
 * O Tesseract carrega um WASM de 3 MB e leva ~200 ms na primeira leitura.
 * Rodando na thread de scan, esse tempo entra no meio do caminho quente e a
 * varredura de itens para junto. Aqui ele trava, se quiser, e a thread de scan
 * continua respondendo — que e o que importa, porque badge que atrasa 200 ms
 * parece travado.
 *
 * ## ## ## O pagamento
 *
 * Nao usa `WorkerRequest`/`WorkerResponse`: sao o contrato do scan, com
 * `type` ja fechado. Este tem uma mensagem so, e forcar ela no envelope
 * compartilhado seria encher o scan de ramos que so servem para isto.
 */
interface ReqOcr {
  type: 'ocr:ler-numeros';
  id: number;
  frame: BgraFrame;
}

const init = workerData as { kind?: string; resourcesDir?: string };

if (init.kind !== 'ocr-numeros') {
  throw new Error(`este arquivo e da thread de OCR, veio kind=${init.kind}`);
}
if (!init.resourcesDir) throw new Error('ocr-numeros sem resourcesDir');

const ocr = new OcrNumeros({ resourcesDir: init.resourcesDir });

parentPort!.on('message', (msg: ReqOcr) => {
  if (msg?.type !== 'ocr:ler-numeros') return;
  void ocr
    .ler(msg.frame)
    .then((payload) => parentPort!.postMessage({ id: msg.id, payload }))
    .catch((err: unknown) => {
      // Devolve `null` em vez de derrubar a thread: quem pediu precisa saber
      // que nao leu, e um `null` ele trata. Uma excecao aqui mataria a thread
      // e todo scan seguinte receberia tempo esgotado.
      console.warn('[ocr-numeros]', err instanceof Error ? err.message : String(err));
      parentPort!.postMessage({ id: msg.id, payload: null });
    });
});