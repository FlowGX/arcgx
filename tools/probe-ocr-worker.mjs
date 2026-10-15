import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

const raw = readFileSync('H:/Arcgxapp/dados/rotulo/raid/live-1792040030399.raw');
const frame = { width: 1920, height: 1080, pixels: new Uint8Array(raw) };

const w = new Worker('H:/Arcgxapp/apps/workers/dist/ocr-worker.js', {
  workerData: { kind: 'ocr-numeros', resourcesDir: 'H:/Arcgxapp/apps/main/resources' },
});

w.on('message', (m) => {
  console.log('id', m.id, '->', JSON.stringify(m.payload, null, 2));
  void w.terminate();
});
w.on('error', (e) => {
  console.log('ERRO:', e.message);
  void w.terminate();
});
w.on('exit', (c) => console.log('saiu com', c));

const t0 = Date.now();
w.postMessage({ type: 'ocr:ler-numeros', id: 1, frame });
console.log('mensagem enviada');

setTimeout(() => {
  console.log(`sem resposta em ${Date.now() - t0}ms`);
  void w.terminate();
}, 25000);