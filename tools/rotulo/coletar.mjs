/**
 * Coleta inventários para rotulagem, sem depender do app.
 *
 * ## Por que um processo separado
 *
 * O `CaptureManager` do app funciona, mas só roda enquanto o painel está
 * aberto — e a tela de inventário é justamente o momento em que o jogador não
 * quer mexer no app. Uma coleta ligada ao app seria interrompida toda vez que
 * ele fechasse ou trocasse de aba, e o rótulo é o insumo mais difícil de
 * conseguir.
 *
 * `wgc-capture` é um módulo napi puro: carrega em Node comum, sem Electron.
 * Rodando separado, a coleta continua com o painel fechado.
 *
 * ## Regra de descarte
 *
 * Inventário parado gera o mesmo frame para sempre. Sem uma regra de "isto é
 * diferente do que eu já vi", o script enche o disco com centenas de cópias
 * da mesma tela. O descarte é por hash do conteúdo de pixels da área da grade:
 * só grava quando a grade muda de fato.
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');
const vis = require('@arcgx/cell-vision');

/**
 * ROI e parâmetros vêm do próprio app, não daqui.
 *
 * `calibrate` do Rust **não aceita `undefined` como objeto** — passar a
 * fourth argumento ausente estoura com "Cannot convert undefined or null to
 * object", que não parece relacionado a geometria nenhuma. E copiar os
 * números para cá criaria uma segunda fonte de verdade: corrigir o painel no
 * app deixaria o coletor coletando a região errada, em silêncio.
 */
const { PANELS, DEFAULT_PANEL } = await import(
  'file:///H:/Arcgxapp/apps/main/dist/scan/panels.js'
);

const CONFIG_CALIBRE = {
  edgeThreshold: 0.22,
  minCell: 16,
  maxCell: 400,
  bandEnergy: 0.45,
  mergeGap: 5,
  refine: true,
  padPx: 8,
};

/** Igual à do app: o título do jogo tem caractere de largura zero no meio. */
const norm = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

const SAIDA = 'H:/Arcgxapp/dados/rotulo/pendente';
const JOGO = 'arcraiders';

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const INTERVALO_MS = Number(arg('ms', 1200));
const MIN_ENTRE = Number(arg('min', 8000));
const MAX_SESSOES = Number(arg('max', 0));

/**
 * ## `--painel` escolhe qual grade coletar
 *
 * Antes so existia o ARMAZENAMENTO (o cofre de Speranza), porque foi o unico
 * painel medido. Agora `panels.ts` tem tambem MOCHILA, USO RAPIDO e BOLSO
 * SEGURO — que e onde esta a carga da raid, a unica coisa que a contagem de
 * raid soma.
 *
 * Default segue sendo o cofre: mudar o padrao faria toda captura ja rotulada
 * mudar de significado sem aviso.
 */
const PAINEL_ID = arg('painel', DEFAULT_PANEL.id);
const PAINEL = PANELS[PAINEL_ID];
if (!PAINEL) {
  console.error(`painel desconhecido: ${PAINEL_ID}`);
  console.error(`disponiveis: ${Object.keys(PANELS).join(', ')}`);
  process.exit(1);
}
if (PAINEL.cols !== 4 || PAINEL.rows !== 5) {
  console.error(
    `painel ${PAINEL_ID} tem grade ${PAINEL.cols}x${PAINEL.rows}, e o coletor assume 4x5`,
  );
  process.exit(1);
}
console.log(`painel: ${PAINEL.label}  (${PAINEL.cols}x${PAINEL.rows})`);

/** Retângulo do painel em pixels deste frame. */
function roiDoFrame(w, h) {
  if (!ROI_FRACAO) return PAINEL.roi;
  return ROI_FRACAO;
}
const ROI_FRACAO = (() => {
  const r = arg('roi', '');
  if (!r) return null;
  const [x, y, w, h] = r.split(',').map(Number);
  return { x: x / 1920, y: y / 1080, width: w / 1920, height: h / 1080 };
})();

/** Hash do conteúdo de pixels da área da grade. */
function hashFrame(frame, spec) {
  const h = createHash('sha1');
  // a grade, e não a tela toda: HUD, relógio e minimap mudam o tempo todo e
  // fariam toda captura parecer diferente
  const { x, y, width, height } = spec;
  const passo = Math.max(1, Math.floor(Math.min(width, height) / 64));
  // `data` é um buffer plano de **bytes**, com `stride` bytes por pixel (BGRA).
  // Indexar por `y * width + x` lê byte errado e devolve `undefined` — e o que
  // mais engana é que não dá erro visível, só um hash que nunca muda.
  const bpp = frame.stride || 4;
  for (let j = 0; j < height; j += passo) {
    for (let i = 0; i < width; i += passo) {
      const px = (y + j) * frame.width + (x + i);
      h.update(frame.data.subarray(px * bpp, px * bpp + 1));
    }
  }
  return h.digest('hex').slice(0, 16);
}

function acharJogo() {
  for (const w of cap.listWindows()) {
    if (norm(w.title).includes(JOGO)) return w;
  }
  return null;
}

function carregarVistos() {
  const arq = join(SAIDA, 'vistos.json');
  if (!existsSync(arq)) return [];
  try {
    return JSON.parse(readFileSync(arq, 'utf8'));
  } catch {
    return [];
  }
}

mkdirSync(SAIDA, { recursive: true });
const vistos = new Set(carregarVistos().map((v) => v.hash));

const janela = acharJogo();
if (!janela) {
  console.error('janela do jogo nao encontrada — abra o ARC Raiders');
  process.exit(1);
}

console.log(`jogo: hwnd 0x${janela.hwnd.toString(16)} "${janela.title}"`);
try {
  // `startCapture` devolve `void` no sucesso — testar o retorno trata o
  // `undefined` como falha e derruba uma captura que funcionou. O estado real
  // é `isRunning()`.
  cap.startCapture(janela.hwnd);
} catch (e) {
  console.error('startCapture lancou:', e.message, '|', cap.lastD3DError());
  process.exit(1);
}
if (!cap.isRunning()) {
  console.error('captura nao subiu:', cap.lastD3DError());
  process.exit(1);
}
console.log(`captura iniciada; poll a cada ${INTERVALO_MS} ms`);

let ultimaGravacao = 0;
let sessoes = 0;
let ultimoHash = null;

const timer = setInterval(() => {
  const f = cap.pollFrame();
  if (!f) return;

  // a grade só é confiável com o jogo em foco; fora disso a janela não é
  // composta e o que vier é lixo
  if (!cap.isTargetForeground(janela.hwnd)) return;

  const roi = roiDoFrame(f.width, f.height);
  const spec = vis.calibrate(
    f.data,
    f.width,
    f.height,
    { x: Math.round(roi.x * f.width), y: Math.round(roi.y * f.height),
      width: Math.round(roi.width * f.width), height: Math.round(roi.height * f.height) },
    CONFIG_CALIBRE,
  );
  if (!spec) return;

  // sem grade de 4x5 não é a tela de inventário
  if (spec.cols !== 4 || spec.rows !== 5) return;

  const hash = hashFrame(f, {
    x: spec.originX,
    y: spec.originY,
    width: spec.cellWidth * spec.cols,
    height: spec.cellHeight * spec.rows,
  });

  const agora = Date.now();
  if (hash === ultimoHash) return;
  ultimoHash = hash;
  if (vistos.has(hash)) return;
  if (agora - ultimaGravacao < MIN_ENTRE) return;

  ultimaGravacao = agora;
  sessoes++;
  const nome = `inv-${String(sessoes).padStart(3, '0')}-${hash}`;
  const dir = join(SAIDA, nome);
  mkdirSync(dir, { recursive: true });

  // o frame cru é o insumo; a conversão para PNG e o recorte em células
  // acontecem no `exportar`, para uma correção de geometria não obrigar a
  // recoletar o jogo
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify(
      {
        hash,
        quando: new Date(agora).toISOString(),
        spec,
        frame: { width: f.width, height: f.height, canais: f.canais ?? 4, formato: 'bgra' },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, 'frame.raw'), Buffer.from(f.data));

  vistos.add(hash);
  writeFileSync(join(SAIDA, 'vistos.json'), JSON.stringify([...vistos].slice(-500), null, 2));

  console.log(`gravado ${nome}  (${spec.cols}x${spec.rows} @ ${f.width}x${f.height})  total ${sessoes}`);

  if (MAX_SESSOES && sessoes >= MAX_SESSOES) {
    clearInterval(timer);
    cap.stopCapture();
    console.log(`limite de ${MAX_SESSOES} atingido`);
    process.exit(0);
  }
}, INTERVALO_MS);

process.on('SIGINT', () => {
  clearInterval(timer);
  cap.stopCapture();
  console.log('\nparado');
  process.exit(0);
});
