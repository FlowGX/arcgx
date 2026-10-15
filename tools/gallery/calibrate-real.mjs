/**
 * Calibração com o pipeline REAL do classificador.
 *
 * ## As três vezes que isso deu errado
 *
 * 1. Geometria chutada (`y=25, size=34`) — a assinatura por grade dava 0/20.
 * 2. Geometria medida com **retângulos de célula errados** (assumi
 *    `{152,367,passo 104}`; o detector acha `{154,378}` com célula 91).
 * 3. Geometria medida com a **assinatura antiga**, e depois reaplicada na nova.
 *
 * Agora as três peças batem: retângulo do detector, reamostragem bilinear do
 * Rust e o mesmo `signatureFromBatchMulti` dos dois lados. O que sobra para
 * escolher é só onde o ícone fica dentro da célula — e isso é medido aqui,
 * contra a captura real.
 *
 * A arte é baixada uma vez e mantida em memória; varrer geometria não
 * rebaixa 100 MB a cada tentativa.
 */

import { readFileSync } from 'node:fs';

import {
  S,
  decodePng,
  montarCelula,
  celulaParaBatch,
  reamostrarBilinear,
} from './build.mjs';

const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');
const M = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery-multi.js');

const CELL_SIZE = 12;

/** Retângulos que o `cell-vision` devolveu para inventario-01.png. */
const CELULAS = [];
for (let r = 0; r < 5; r++)
  for (let c = 0; c < 4; c++)
    CELULAS.push({ x: [154, 257, 361, 465][c], y: [378, 482, 586, 690, 794][r], w: 91, h: 91 });

const img = decodePng(readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const px = img.canais === 4 ? 4 : 3;

/* ------------------------------------------------- células do jogo (12×12) */

const batchesJogo = CELULAS.map((c) => {
  const rgb = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) {
    const sy = c.y + y;
    if (sy < 0 || sy >= img.h) continue;
    for (let x = 0; x < S; x++) {
      const sx = c.x + x;
      if (sx < 0 || sx >= img.w) continue;
      const p = (sy * img.w + sx) * px;
      const d = (y * S + x) * 3;
      rgb[d] = img.data[p];
      rgb[d + 1] = img.data[p + 1];
      rgb[d + 2] = img.data[p + 2];
    }
  }
  // mesma sequência do Rust: 96×96 da captura -> bilinear -> 12×12
  return reamostrarBilinear(rgb, CELL_SIZE);
});

const sigsJogo = batchesJogo.map((b) => M.signatureFromBatchMulti(b, CELL_SIZE, 0));
console.log(`células do jogo: ${sigsJogo.length} (assinadas como o worker faz)`);

/* ------------------------------------------------------------ arte em cache */

const itens = JSON.parse(readFileSync('H:/Arcgxapp/dados/game/items.json', 'utf8')).items;
const alvos = Object.values(itens).filter((i) => i.imageFilename);

console.log(`baixando arte de ${alvos.length} itens...\n`);
const arte = [];
{
  let i = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (;;) {
        const k = i++;
        if (k >= alvos.length) return;
        const it = alvos[k];
        try {
          const r = await fetch(it.imageFilename);
          if (!r.ok) throw new Error('http');
          arte.push([it.id, decodePng(Buffer.from(await r.arrayBuffer()))]);
        } catch {
          /* segue */
        }
      }
    }),
  );
}
console.log(`artes em cache: ${arte.length}\n`);

/* ---------------------------------------------------------------- varredura */

console.log('   x    y  size   nota_media  margem_media  aceitas(nota>=.70 e margem>=.01)');
console.log('-'.repeat(78));

let melhor = null;
for (const size of [40, 46, 52, 58, 64, 70, 76]) {
  for (const y of [10, 16, 22, 28, 34]) {
    const x = Math.round((S - size) / 2);
    const geo = { x, y, size };

    const gal = arte.map(([, im]) =>
      M.signatureFromBatchMulti(reamostrarBilinear(montarCelula(im, geo), CELL_SIZE), CELL_SIZE, 0),
    );

    let somaNota = 0;
    let somaMargem = 0;
    let aceitas = 0;

    for (const sig of sigsJogo) {
      let a = -1;
      let b = -1;
      for (const g of gal) {
        const c = G.cosine(sig, g);
        if (c > a) {
          b = a;
          a = c;
        } else if (c > b) b = c;
      }
      const m = a - (b < 0 ? 0 : b);
      somaNota += a;
      somaMargem += m;
      if (a >= 0.7 && m >= 0.01) aceitas++;
    }

    const n = sigsJogo.length;
    const media = somaMargem / n;
    console.log(
      `${String(x).padStart(4)} ${String(y).padStart(4)} ${String(size).padStart(5)}   ` +
        `${(somaNota / n).toFixed(4)}      ${media.toFixed(4)}        ${aceitas}/${n}`,
    );
    if (!melhor || media > melhor.media) melhor = { geo, media, aceitas, nota: somaNota / n };
  }
}

console.log('\n--- melhor ---');
console.log(JSON.stringify(melhor, null, 2));
console.log(`\npara reconstruir: --x ${melhor.geo.x} --y ${melhor.geo.y} --size ${melhor.geo.size} --cell ${CELL_SIZE}`);
