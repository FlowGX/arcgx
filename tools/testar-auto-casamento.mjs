/**
 * A galeria casa consigo mesma pelo caminho do Node?
 *
 * ## ## ## O teste que separa "entrada errada" de "modelo diferente"
 *
 * O `testar-classificador.mjs` dava similaridade 0,14 onde o Python da 0,62,
 * com o mesmo `encoder.onnx` e a mesma `galeria.bin`. Isso deixa duas
 * hipoteses, e elas pedem consertos opostos:
 *
 *   a) o **preprocessamento** do Node monta um tensor diferente
 *   b) a **inferencia** diverge, e nem a entrada importa
 *
 * O teste aqui fecha as duas: codifica a arte do proprio catalogo (que veio
 * do mesmo `moldura.py` que gerou a galeria) e pergunta se ela e casada
 * **consigo mesma**.
 *
 * Se sim: o ONNX e a entrada estao certain, e o problema esta no recorte do
 * jogo. Se nao: o problema e anterior, e comparar resultado de recorte nao
 * adianta nada.
 *
 * A primeira versao deste teste passou 92x104 para uma imagem que ja estava
 * em 224x224, e por isso mediu um redimensionamento invalido em vez da
 * diferenca real.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = 'H:/Arcgxapp';
const { EncoderClassifier } = await import(
  pathToFileURL(path.join(RAIZ, 'apps/workers/dist/encoder-classifier.js')).href
);

const bgra = new Uint8Array(readFileSync(path.join(RAIZ, 'dados/rotulo/_gal.bgra')));
const lado = bgra.length / 4;
const dim = Math.sqrt(lado);
console.log(`arte de teste: ${dim}x${dim} (${bgra.length} bytes)`);

const cel = await EncoderClassifier.create(path.join(RAIZ, 'apps/main/resources'));
console.log(`galeria: ${cel.size}  espaco ${cel.space}  lado ${cel.lado}\n`);

const emb = await cel.embed([{ pixels: bgra, width: dim, height: dim }]);
const hit = cel.search(emb);

console.log(`embedding[0..4]: ${Array.from(emb.slice(0, 5)).map((v) => v.toFixed(4)).join(', ')}`);
console.log(`\ntopo-1: ${hit.itemId}  score ${hit.score.toFixed(4)}`);
console.log(`2o:     ${hit.runnerUp}  score ${hit.runnerUpScore.toFixed(4)}`);
console.log(`margem: ${(hit.score - hit.runnerUpScore).toFixed(4)}  ambigua=${hit.ambiguous}`);

console.log(
  hit.itemId === 'agave'
    ? '\nOK: a arte do catalogo casa consigo mesma. O ONNX e a galeria estao\n' +
        '    certainos, e a divergencia do recorte esta no preprocessamento\n' +
        '    da celula — enquadramento, nao modelo.'
    : '\nFALHA: a arte do catalogo nao casa consigo mesma. O problema e\n' +
        '        anterior ao recorte: galeria mal lida ou inferencia diferente.',
);