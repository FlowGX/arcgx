import { Worker as WorkerThread } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@arcgx/shared';
import type { WorkerInit, WorkerRequest, WorkerResponse } from './protocol.js';

const log = createLogger('worker-pool');
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pool de 1 worker por papel. Rodar scan/ocr em worker_threads tira a carga
 * de CPU (e o GC) do processo main, que precisa responder IPC a 15 Hz.
 */
export class WorkerPool {
  private worker: WorkerThread | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly init: WorkerInit) {}

  private get script(): string {
    /**
     * `ocr-numeros` e a thread de leitura de cabecalho, com Tesseract, em
     * `ocr-worker.ts`. `ocr-numeros.ts` e so a biblioteca que ele importa — e
     * aponta para ela, a thread carrega o arquivo, nao registra nenhum handler
     * e **sai com codigo 0**, sem mensagem e sem erro. O sintoma e um scan que
     * funciona e um HUD que nunca chega.
     */
    if (this.init.kind === 'ocr-numeros') return path.join(here, 'ocr-worker.js');
    if (this.init.kind === 'ocr') return path.join(here, 'ocr-worker.js');
    return path.join(here, 'scan-worker.js');
  }

  get modelsDir(): string {
    return this.init.modelsDir;
  }

  start(): void {
    if (this.worker) return;
    this.worker = new WorkerThread(this.script, { workerData: this.init });
    this.worker.on('message', (msg: WorkerResponse) => this.settle(msg));
    this.worker.on('error', (err) => {
      log.error(`worker ${this.init.kind} morreu`, err);
      this.failAll(err);
    });
    this.worker.on('exit', (code) => {
      log.warn(`worker ${this.init.kind} saiu (code ${code})`);
      this.worker = null;
      this.failAll(new Error(`worker encerrado (code ${code})`));
    });
    log.info(`${this.init.kind} worker iniciado`);
  }

  async request<T>(payload: Omit<WorkerRequest, 'id'>): Promise<T> {
    this.start();
    const id = this.nextId++;
    const message = { id, ...payload } as WorkerRequest;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage(message);
    });
  }

  async terminate(): Promise<void> {
    if (!this.worker) return;
    const w = this.worker;
    this.worker = null;
    await w.terminate();
    this.failAll(new Error('worker encerrado'));
  }

  private settle(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.payload);
    else entry.reject(new Error(msg.error));
  }

  private failAll(err: Error): void {
    for (const [, entry] of this.pending) entry.reject(err);
    this.pending.clear();
  }
}