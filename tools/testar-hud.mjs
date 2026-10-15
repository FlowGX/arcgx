/**
 * O caminho de HUD inteiro, do frame ao overlay.
 *
 * ## ## ## O que este teste cobre
 *
 * O leitor (`ocr-numeros`), a thread separada, o roteamento do worker, o
 * parser e o `ScanPayload`. Cada pedaco foi testado sozinho; o que pode
 * quebrar e a costura entre eles — e a costura e justamente onde o motor do
 * Windows falhava, publicando `available: true` e devolvendo nada.
 *
 * ## ## ## Por que roda offline
 *
 * `--frame <arquivo.raw>` nao captura nada. Um teste que depende do jogo estar
 * aberto com loot no inventario depende do momento, e os dois numeros que
 * importam validar (`6/22` com 6 itens contados, `29.484` de total) so existem
 * em capturas ja salvas.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Geometria dos painéis, espelhando `apps/main/src/scan/panels.ts`.
 *
 * Só a MOCHILA interessa para a verdade de campo; as outras entram para
 * exercitar o caminho multi-região, que é o que o app faz.
 */
const REGIOES = [
  {
    id: 'mochila',
    rect: { x: 1043, y: 271, width: 416, height: 624 },
    cols: 4,
    rows: 6,
    cells: celulas(1043, 271, 4, 6),
  },
  {
    id: 'uso-rapido',
    rect: { x: 1503, y: 271, width: 312, height: 208 },
    cols: 3,
    rows: 2,
    cells: celulas(1503, 271, 3, 2),
  },
  {
    id: 'bolso-seguro',
    rect: { x: 1503, y: 711, width: 312, height: 104 },
    cols: 3,
    rows: 1,
    cells: celulas(1503, 711, 3, 1),
  },
];

function celulas(ox, oy, cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: Math.round(ox + c * 104), y: Math.round(oy + r * 104), width: 92, height: 104 });
    }
  }
  return out;
}



const RAIZ = 'H:/Arcgxapp';
const { WorkerPool } = await import(
  pathToFileURL(path.join(RAIZ, 'apps/workers/dist/pool.js')).href
);

/**
 * Verdade de campo, medida a mao nos mesmos frames:
 *
 *   frame                          mochila   total      celulas por imagem
 *   live-1791969417953.raw         4/20      43.679     4
 *   live-1791984162950.raw         10/22     34.102     10
 *   live-1792038392457.raw         0/10      2.000      0
 *   live-1792040030399.raw         6/22      29.484     6
 *
 * O total e o que o **jogo** escreve no cabecalho, e as celulas sao a contagem
 * por imagem do `ml/contar-live.py` — metodos independentes. E o cruzamento dos
 * dois que pegou a mochila de 6 linhas.
 */
const VERDADE = {
  'live-1791969417953.raw': { mochila: [4, 20], total: 43679 },
  'live-1791984162950.raw': { mochila: [10, 22], total: 34102 },
  'live-1792038392457.raw': { mochila: [0, 10], total: 2000 },
  'live-1792040030399.raw': { mochila: [6, 22], total: 29484 },
};

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

/**
 * `--todos` e flag sem valor; `arg()` le o proximo argumento e devolveria
 * `undefined`, caindo no frame padrao sem rodar nenhum dos outros.
 */
const alvos = args.includes('--todos')
  ? Object.keys(VERDADE)
  : [arg('frame', 'live-1792040030399.raw')];

const pool = new WorkerPool({
  kind: 'scan',
  modelsDir: path.join(RAIZ, 'models'),
  resourcesDir: path.join(RAIZ, 'apps/main/resources'),
});

let falhas = 0;
let checados = 0;

for (const nome of alvos) {
  const truth = VERDADE[nome];
  const file = path.join(RAIZ, 'dados/rotulo/raid', nome);
  const pixels = new Uint8Array(readFileSync(file));
  const W = 1920;
  const H = 1080;

  /**
   * Duas leituras, como a cadencia real de 2 Hz.
   *
   * O leitor exige que um valor **repita** antes de entrar: a primeira aparição
   * vira candidato e a segunda confirma. Isso é proposital — frames
   * compositados pela metade durante animação degradam vários campos juntos, e
   * sem o filtro o contador do overlay pisca.
   *
   * O custo é uma leitura de atraso quando o número muda de verdade. Ler uma
   * vez só, como antes, dá sempre vazio — e um teste que só faz uma leitura
   * mediria o atraso, não a acerto.
   */
  const pedir = () =>
    pool.request({
      type: 'scan',
      frame: { width: W, height: H, pixels },
      roi: REGIOES[0].rect,
      regioes: REGIOES,
      gridCols: REGIOES[0].cols,
      gridRows: REGIOES[0].rows,
      querOcr: true,
    });

  const t0 = performance.now();
  await pedir();
  const payload = await pedir();
  const ms = performance.now() - t0;

  const hud = payload.hud;
  console.log(`\n=== ${nome} ===`);
  console.log(`  scan ${ms.toFixed(0)}ms  via=${payload.via}  classificados=${payload.classified}`);
  console.log(`  hud: ${hud ? `${hud.ms.toFixed(0)}ms` : 'AUSENTE'}`);
  if (!hud) {
    console.error('  FALHA: payload sem `hud`');
    falhas++;
    continue;
  }
  console.log(`  contadores: ${JSON.stringify(hud.contadores)}`);
  console.log(`  total: ${hud.total}`);

  if (truth) {
    checados += 3;
    const c = hud.contadores.mochila;
    const okMochila = c && c.ocupado === truth.mochila[0] && c.capacidade === truth.mochila[1];
    if (!okMochila) falhas++;
    console.log(
      `  ${okMochila ? 'OK  ' : 'ERR '} mochila ${c ? `${c.ocupado}/${c.capacidade}` : 'null'} ` +
        `esperado ${truth.mochila[0]}/${truth.mochila[1]}`,
    );

    const okTotal = hud.total === truth.total;
    if (!okTotal) falhas++;
    console.log(`  ${okTotal ? 'OK  ' : 'ERR '} total ${hud.total} esperado ${truth.total}`);
  }
}

await pool.terminate();

console.log(`\n${checados - falhas}/${checados} verificacoes`);
if (falhas) {
  console.error(`\nFALHA: ${falhas}`);
  process.exit(1);
}
console.log('ok: HUD lido do frame real, ponta a ponta');