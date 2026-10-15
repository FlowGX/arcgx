/**
 * Prova que o encoder esta no caminho quente do worker.
 *
 * ## ## ## Por que este teste existe
 *
 * A integracao do encoder passou no modulo isolado e falhou no app. O que
 * quebrava era a **galeria exportada com outro modelo** que o `.onnx` — o
 * `EncoderClassifier` devolvia 0,14 e o overlay mostrava o item errado sem
 * nenhum erro. Nenhum teste checava essa combinacao, so cada ponta sozinha.
 *
 * Aqui as duas pontas se encontram: o frame sintetico tem 9 celulas em posicao
 * conhecida, o worker faz o recorte e o casamento, e a saida e comparada com o
 * gabarito. Se `via` vier `dhash` em vez de `encoder`, o scan voltou a
 * degradar em silencio — que e exatamente o modo de falha que o `via` existe
 * para tornar visivel.
 *
 * Montar o frame em Python e nao em Node e proposital: `pngjs` nao e
 * dependencia do projeto, e o PIL ja sabe ler os recortes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = 'H:/Arcgxapp';
const { WorkerPool } = await import(
  pathToFileURL(path.join(RAIZ, 'apps/workers/dist/pool.js')).href
);

const W = 1920;
const H = 1080;

/** `--frame <arquivo.raw>` aponta para uma captura real do jogo. */
const argFrame = (() => {
  const i = process.argv.indexOf('--frame');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const FRAME = argFrame ?? path.join(RAIZ, 'dados/rotulo/_sintetico.raw');

/** Geometria medida do MOCHILA — a mesma de `cellsOf` em `panels.ts`. */
const ROI = { x: 1043, y: 271, width: 416, height: 520 };
const COLS = 4;
const ROWS = 5;
const CELL_W = 92;
const CELL_H = 104;

/**
 * Retangulos de cada celula, em coordenadas do frame.
 *
 * O card e 92 px de largura com passo 104: sobra 12 px de respiro entre um e
 * outro. Recortar com o passo como largura puxa fundo para dentro e derruba a
 * similaridade sem nada parecer errado.
 */
const cellsOf = () => {
  const passoX = ROI.width / COLS;
  const passoY = ROI.height / ROWS;
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      out.push({
        x: Math.round(ROI.x + c * passoX),
        y: Math.round(ROI.y + r * passoY),
        width: CELL_W,
        height: CELL_H,
      });
    }
  }
  return out;
};

/** O que cada celula ocupada do frame sintetico realmente e. */
const GABARITO = {
  '0,0': 'medium-ammo',
  '0,2': 'looting-mk-2',
  '1,0': 'medium-ammo',
  '1,1': 'torrente-iv',
  '1,2': 'medium-ammo',
  '2,1': 'defibrillator-recipe',
  '2,2': 'medium-ammo',
  '3,0': 'raider-tokens',
  '3,1': 'anvil-splitter',
};

const pixels = new Uint8Array(readFileSync(FRAME));
if (pixels.length !== W * H * 4) throw new Error(`frame com ${pixels.length} bytes, esperado ${W * H * 4}`);
console.log(`frame: ${FRAME}${argFrame ? '' : ' (sintetico)'}`);

const pool = new WorkerPool({
  kind: 'scan',
  modelsDir: path.join(RAIZ, 'models'),
  resourcesDir: path.join(RAIZ, 'apps/main/resources'),
});

const payload = await pool.request({
  type: 'scan',
  frame: { width: W, height: H, pixels },
  roi: ROI,
  gridCols: COLS,
  gridRows: ROWS,
  cells: cellsOf(),
});

/**
 * Tres passadas: a primeira carrega galeria e sessao ONNX e nao mede nada de
 * custo — ela dominada pelo startup. Sao a segunda e a terceira que dizem o
 * que o loop de scan sente por quadro.
 */
const tempos = [payload.ms];
for (let i = 0; i < 2; i++) {
  const r = await pool.request({
    type: 'scan',
    frame: { width: W, height: H, pixels },
    roi: ROI,
    gridCols: COLS,
    gridRows: ROWS,
    cells: cellsOf(),
  });
  tempos.push(r.ms);
}
console.log(
  `\nlatencia: 1a ${tempos[0].toFixed(0)} ms (com carga do ONNX)  ` +
    `estavel ${tempos.slice(1).map((t) => t.toFixed(1)).join(' / ')} ms`,
);

console.log(`\nvia=${payload.via}  classificados=${payload.classified}/${payload.cells.length}` +
  `  grid=${payload.grid ? `${payload.grid.cols}x${payload.grid.rows}` : 'nenhuma'}` +
  `  fallback=${payload.fallback}  ${payload.ms.toFixed(1)} ms\n`);

/**
 * Casa pelo **retangulo detectado**, nunca pelo `index`.
 *
 * O detector nativo decide cols/rows a partir dos pixels, e num frame
 * sintetico — fundo chapado, sem a moldura azul da UI real — ele chega numa
 * grade 3x2 em vez de 4x5. Usar `index % 4` e_rb*aria a conta e acusaria o
 * encoder de errar itens que ele acertou.
 *
 * Como o frame e sintetico, cada celula occupantada tem posicao conhecida em
 * pixels. O retangulo que o worker devolve diz onde ele vio algo; ai que se
 * compara com o gabarito.
 */
const posicaoDe = (rect) => {
  const col = Math.round((rect.x - ROI.x) / (ROI.width / COLS));
  const row = Math.round((rect.y - ROI.y) / (ROI.height / ROWS));
  return `${col},${row}`;
};

let acertos = 0;
let checados = 0;
const linhas = [];

/**
 * Num frame real nao ha gabarito — nao da para marcar acerto/erro, porque
 * ninguem anotou o que o jogador tinha nos slots. O que da para checar e
 * **coerencia com o Python**: as duas implementacoes, independentes, tem de
 * concordar sobre o mesmo pixel. Por isso o frame real so imprime as celulas.
 */
if (argFrame) {
  for (const c of [...payload.cells].sort((a, b) => a.index - b.index)) {
    linhas.push(
      `${posicaoDe(c.rect).padEnd(6)} ${String(c.itemId ?? 'null').padEnd(26)} ` +
        `${c.score.toFixed(3)}  2o=${String(c.runnerUp ?? '-').padEnd(24)} ` +
        `${c.familia ? `fam=${c.familia}${c.levelVariant ? ' (nivel)' : ''}` : 'fam=-'}`,
    );
  }
} else {
  for (const c of payload.cells) {
    const pos = posicaoDe(c.rect);
    const esperado = GABARITO[pos];
    if (!esperado) continue; // celula vazia do frame sintetico
    checados++;
    const ok = c.itemId === esperado;
    if (ok) acertos++;
    linhas.push(
      `${pos.padEnd(6)} ${ok ? 'OK  ' : 'ERR '}${String(c.itemId ?? 'null').padEnd(24)} ` +
        `${c.score.toFixed(3)}  2o=${String(c.runnerUp ?? '-').padEnd(22)} esperado ${esperado}`,
    );
  }
}

console.log(linhas.join('\n'));
const taxa = checados ? (acertos / checados) * 100 : 0;

if (!argFrame) {
  const faltando = Object.keys(GABARITO).filter((p) => !linhas.some((l) => l.startsWith(p)));
  if (faltando.length) {
    console.log(`\nnao detectadas pelo detector nativo: ${faltando.join(', ')}`);
    console.log('(frame sintetico sem a UI real — confirme com o jogo aberto)');
  }
  console.log(`\n${acertos}/${checados} corretos (${taxa.toFixed(0)}%)`);
} else {
  console.log(`\n${payload.classified}/${payload.cells.length} com item`);
}

writeFileSync(
  path.join(RAIZ, 'dados/rotulo/_worker-resultado.json'),
  JSON.stringify(payload, null, 2),
);

// `terminate`, nao `dispose`: o metodo nao existe e a chamada opcional era
// silenciosamente um no-op — o teste passava, imprimia "ok" e ficava parado
// para sempre com a thread viva. Falhar aqui e melhor que travar o CI.
await pool.terminate();

const problema = [];
if (payload.via !== 'encoder') problema.push(`via=${payload.via}, esperava encoder`);
if (payload.fallback) problema.push('detector nativo nao achou a grade');
if (!argFrame) {
  // O detector nativo ve menos celulas no frame sintetico do que no jogo real,
  // entao a exigencia e sobre as celulas que ele **achou**, nao sobre as 9.
  if (checados < 3) {
    problema.push(`so ${checados} celulas com gabarito — frame sintetico insuficiente`);
  } else if (taxa < 70) {
    problema.push(`acuracia ${taxa.toFixed(0)}% abaixo de 70%`);
  }
}
if (problema.length) {
  console.error(`\nFALHA: ${problema.join('; ')}`);
  process.exit(1);
}
console.log(argFrame ? 'ok: encoder no caminho quente, frame real' : 'ok: encoder no caminho quente, com gabarito');