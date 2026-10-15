/**
 * Converte as capturas coletadas em recortes prontos para rotulagem.
 *
 * ## Por que um passo separado
 *
 * O coletor grava o frame cru (BGRA) e a geometria detectada. Recortar depois
 * significa que corrigir a geometria não obriga o jogador a abrir o jogo de
 * novo — e a geometria já esteve errada mais de uma vez neste projeto.
 *
 * ## Formato
 *
 * Cada pasta vira um PNG por célula (115x115, com a borda que a célula real
 * tem) e um `capturas.json` na raiz. A página de rotulagem **não** consegue
 * listar diretórios em `file://`, então o índice precisa existir em arquivo:
 * sem ele, a página abriria vazia e sem erro nenhum.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { encodePng } from '../gallery/png-encode.mjs';

/**
 * ROI do painel, tirada do próprio app.
 *
 * O mesmo cuidado do coletor: `calibrate` devolve a grade **relativa à região
 * passada**, e é preciso somar a origem dessa região para obter o pixel
 * absoluto. Pular essa soma desloca todo o recorte — e o sintoma é enganoso:
 * a maioria das células vira pedaço do HUD ("ARMAZENAMENTO", "436.8") e
 * algumas, por acaso, caem em ícone e parecem certas.
 */
const { ARMAZENAMENTO } = await import('file:///H:/Arcgxapp/apps/main/dist/scan/panels.js');

const PENDENTE = 'H:/Arcgxapp/dados/rotulo/pendente';
const SAIDA = 'H:/Arcgxapp/dados/rotulo/lote';
const GEOMETRIA = 'H:/Arcgxapp/dados/rotulo/geometria.json';

/**
 * Sem margem.
 *
 * Uma borda de 12 px ajuda o olho a reconhecer a célula na folha de contato,
 * e é por isso que existia. Mas o classificador consome a célula **exata**,
 * do `cellWidth × cellHeight` que o `cellsFromSpec` devolve. Treinar sobre um
 * recorte e inferir sobre outro é um dessincronia silenciosa: o modelo acerta
 * no papel e erre no app, e a culpa parece ser do modelo.
 */
const PAD = 0;

/**
 * Faixa plausível de uma célula do inventário.
 *
 * O filtro antigo era só `cols === 4 && rows === 5`, e isso aceita qualquer
 * arranjo 4x5 que exista na tela. Das 82 capturas, 22 "passaram" sendo lixo —
 * células de 17 px no HUD, blocos de 178x182 em menus. Vinte por cento de dado
 * contaminado parece bom até a primeira folha de contato mostrar que metade
 * não é inventário.
 */
const PLAUSIVEL = {
  cellWidth: [85, 100],
  cellHeight: [98, 112],
  pitch: [98, 112],
};
const dentro = (v, [a, b]) => v >= a && v <= b;

function specPlausivel(s) {
  return (
    s &&
    s.cols === 4 &&
    s.rows === 5 &&
    dentro(s.cellWidth, PLAUSIVEL.cellWidth) &&
    dentro(s.cellHeight, PLAUSIVEL.cellHeight) &&
    dentro(s.pitch, PLAUSIVEL.pitch)
  );
}

/** BGRA -> RGBA. O WGC entrega BGRA; o PNG quer RGBA. */
function bgraParaRgba(buf, w, h, stride = 4) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const s = i * stride;
    out[o] = buf[s + 2];
    out[o + 1] = buf[s + 1];
    out[o + 2] = buf[s];
    out[o + 3] = 255;
  }
  return out;
}

function recorte(rgba, W, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= 1080) continue;
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= W) continue;
      rgba.copy(out, (j * w + i) * 4, (sy * W + sx) * 4, (sy * W + sx) * 4 + 4);
    }
  }
  return out;
}

mkdirSync(SAIDA, { recursive: true });

/**
 * Geometria única para todas as capturas.
 *
 * Os 60{detector} bons concordam entre si (origem 0±2, célula 91-94x101-104,
 * passo 103-105). A variação é ruído do detector, não o inventário se movendo
 * — e ruído aqui é caro: cada recorte sairia com o corte um pouco diferente,
 * o mesmo item teria dez aparências, e o treino aprenderia a diferença entre
 * recortes em vez do conteúdo.
 *
 * A mediana das detecções plausíveis vira a geometria canônica, e vale para
 * todas. Uma correção futura é um número só neste arquivo.
 */
const GEO = JSON.parse(readFileSync(GEOMETRIA, 'utf8'));
console.log(`geometria canonica: ${JSON.stringify(GEO)}`);

const pastas = existsSync(PENDENTE)
  ? readdirSync(PENDENTE, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('inv-'))
      .map((d) => d.name)
      .sort()
  : [];

const indice = [];
let celulasTotal = 0;
let falhas = 0;

for (const nome of pastas) {
  const dir = join(PENDENTE, nome);
  const metaArq = join(dir, 'meta.json');
  const rawArq = join(dir, 'frame.raw');
  if (!existsSync(metaArq) || !existsSync(rawArq)) {
    falhas++;
    continue;
  }

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaArq, 'utf8'));
  } catch {
    falhas++;
    continue;
  }

  const spec = meta.spec;
  if (!specPlausivel(spec)) {
    falhas++;
    continue;
  }

  const W = meta.frame.width;
  const H = meta.frame.height;
  const stride = meta.frame.canais === 3 ? 3 : 4;
  const raw = readFileSync(rawArq);
  const rgba = bgraParaRgba(raw, W, H, stride);

  const destino = join(SAIDA, nome);
  mkdirSync(destino, { recursive: true });

  let n = 0;
  const roi = {
    x: Math.round(ARMAZENAMENTO.roi.x * W),
    y: Math.round(ARMAZENAMENTO.roi.y * H),
    width: Math.round(ARMAZENAMENTO.roi.width * W),
    height: Math.round(ARMAZENAMENTO.roi.height * H),
  };

  for (let c = 0; c < GEO.cols; c++) {
    for (let r = 0; r < GEO.rows; r++) {
      // `roi.x + spec.originX + c * spec.pitch` — a mesma conta do
      // `cellsFromSpec` do app, e o mesmo laço coluna-primeiro
      const x = roi.x + GEO.originX + Math.round(c * GEO.pitch) - PAD;
      const y = roi.y + GEO.originY + Math.round(r * GEO.pitch) - PAD;
      const lado = Math.round(GEO.cellWidth);
      const png = recorte(rgba, W, x, y, lado, Math.round(GEO.cellHeight));
      const id = String(n).padStart(2, '0');
      writeFileSync(join(destino, `${id}.png`), encodePng(png, lado, Math.round(GEO.cellHeight)));
      n++;
      celulasTotal++;
    }
  }

  indice.push({ nome, celulas: n, quando: meta.quando, hash: meta.hash });
  void H;
}

writeFileSync(
  join(SAIDA, 'capturas.json'),
  JSON.stringify({ versao: 1, total: indice.length, capturas: indice }, null, 2),
);

/**
 * O índice também vira JS na raiz, ao lado da página.
 *
 * A página abre por `file://`, e `fetch` de `file://` é bloqueado: com
 * `fetch`, a lista de capturas simplesmente não carrega e a página abre vazia
 * **sem nenhuma mensagem**. Um `<script src>` contorna e funciona offline,
 * que é o caso real de uso.
 */
writeFileSync(
  'H:/Arcgxapp/dados/rotulo/capturas.js',
  `window.CAPTURAS = ${JSON.stringify(indice)};\n` +
    `window.VERSAO_ROTULO = ${Date.now()};\n`,
);

console.log(`${indice.length} capturas processadas, ${celulasTotal} celulas, ${falhas} falhas`);
console.log(`-> ${SAIDA}`);
