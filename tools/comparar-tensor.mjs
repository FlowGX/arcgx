/**
 * Compara o tensor que o Node monta com o que o Python monta, celula a celula.
 *
 * ## ## ## ## Por que comparar tensor e nao resultado
 *
 * O classificador em Node dava similaridade 0,18 onde o Python da 0,62, e os
 * dois rodam o **mesmo** `encoder.onnx` contra a **mesma** `galeria.bin`. A
 * diferenca, entao, esta antes da inferencia: no que entra no modelo.
 *
 * Comparar o resultado final esconderia onde. Comparando os tensores
 * entrada, da para ver se a divergencia e de canal (BGRA/RGB), de enquadramento
 * (a barra neutralizada so no Python), de resize (bilinear no PIL, o mais
 * proximo no JS) ou de normalizacao.
 *
 * Cada etapa e verificada por um numero, nao por impressao visual — que e o
 * que falha aqui: 0,18 e 0,62 parecem "a imagem esta diferente" e nao dizem
 * onde.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as ort from 'onnxruntime-node';

const RAIZ = 'H:/Arcgxapp';
const CELULA_W = 92;
const CELULA_H = 104;
const L = 224;

const MEDIA = [0.485, 0.456, 0.406];
const DESVIO = [0.229, 0.224, 0.225];

/** Le um .npy (float32, C-order) escrito pelo Python. */
function lerNpy(caminho) {
  const buf = readFileSync(caminho);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const major = dv.getUint8(6);
  const ndim = dv.getUint8(7);
  let p = 10;
  let shape = [];
  let dataType = 0;
  for (let d = 0; d < ndim; d++) {
    if (major === 1) {
      shape.push(dv.getUint16(p, true));
      p += 2;
    } else {
      shape.push(dv.getUint32(p, true));
      p += 4;
    }
  }
  if (major === 1) p += 2; // dtype
  dataType = dv.getUint8(10);
  const dados = new Float32Array(
    buf.buffer.slice(buf.byteOffset + p, buf.byteOffset + buf.byteLength),
  );
  return { shape, dados };
}

const sess = await ort.InferenceSession.create(
  path.join(RAIZ, 'apps/main/resources/_galeria/encoder.onnx'),
  { executionProviders: ['cpu'] },
);

const bgra = new Uint8Array(
  readFileSync(path.join(RAIZ, 'dados/rotulo/live-celulas/mochila-01-01.bgra')),
);

/** ## ## Resize: PIL usa BILINEAR, e nao o mais proximo
 *
 * A primeira versao fazia `Math.round(x * passo)`, que e **nearest**. Num
 * upscale de 92x104 para 224x224 o nearest joga fora 70% dos pixels de
 * origem e deixa serrilha que o modelo nunca viu em treino — as augmentation
 * de `ml/treinar-arte.py` usam `LANCZOS`.
 */
function paraNchw(origem, largura, altura, destino, base) {
  const plano = L * L;
  for (let y = 0; y < L; y++) {
    const fy = (y * (altura - 1)) / (L - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(altura - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < L; x++) {
      const fx = (x * (largura - 1)) / (L - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(largura - 1, x0 + 1);
      const wx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const i0 = (y0 * largura + x0) * 4 + (2 - c); // BGRA -> RGB
        const i1 = (y0 * largura + x1) * 4 + (2 - c);
        const i2 = (y1 * largura + x0) * 4 + (2 - c);
        const i3 = (y1 * largura + x1) * 4 + (2 - c);
        const v =
          origem[i0] * (1 - wy) * (1 - wx) +
          origem[i1] * (1 - wy) * wx +
          origem[i2] * wy * (1 - wx) +
          origem[i3] * wy * wx;
        destino[base + c * plano + y * L + x] = (v / 255 - MEDIA[c]) / DESVIO[c];
      }
    }
  }
}

const dado = new Float32Array(3 * L * L);
paraNchw(bgra, CELULA_W, CELULA_H, dado, 0);

const tensor = new ort.Tensor('float32', dado, [1, 3, L, L]);
const nomeEntrada = sess.inputNames[0] ?? 'entrada';
const saida = await sess.run({ [nomeEntrada]: tensor });
const embJs = saida[sess.outputNames[0] ?? 'embedding'].data;

const py = lerNpy(path.join(RAIZ, 'dados/rotulo/_dbg-py.npy'));
const py2 = lerNpy(path.join(RAIZ, 'dados/rotulo/_dbg-py2.npy'));

function compara(nome, pyv) {
  const dif = [];
  let max = 0;
  for (let i = 0; i < pyv.length; i++) {
    const d = Math.abs(pyv[i] - embJs[i]);
    dif.push(d);
    if (d > max) max = d;
  }
  const media = dif.reduce((a, b) => a + b, 0) / dif.length;
  console.log(
    `${nome.padEnd(34)} diff media ${media.toFixed(4)}  max ${max.toFixed(4)}  ` +
      `py[0..3]=${pyv.slice(0, 4).map((v) => v.toFixed(3)).join(',')}  ` +
      `js[0..3]=${Array.from(embJs.slice(0, 4)).map((v) => v.toFixed(3)).join(',')}`,
  );
}

console.log('node embedding[0..3]:', Array.from(embJs.slice(0, 4)).map((v) => v.toFixed(3)).join(', '));
console.log('');
compara('python COM enquadrar', py.dados);
compara('python SEM enquadrar', py2.dados);
console.log(`\nshape python: ${py.shape}  node: [1,3,${L},${L}]`);