/**
 * Classificador contra uma captura real.
 *
 *   node tools/gallery/test-classify.mjs [captura.png]
 *
 * Extrai as células da grade medida, assina cada uma e casa contra a galeria
 * em `models/gallery.json`. É o teste que substitui o "será que funciona":
 * o classificador só vale se ele nomeia as células de uma foto de verdade.
 */

import { readFileSync } from 'node:fs';

import { S, decodePng, celulaParaBatch } from './build.mjs';

const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');

const CAPTURE =
  process.argv[2] ?? 'H:/Arcgxapp-ref/captures/inventario-01.png';

const GRADE = { cols: 4, rows: 5, x0: 152, y0: 367, passo: 104 };

const img = decodePng(readFileSync(CAPTURE));
const galeria = JSON.parse(readFileSync('H:/Arcgxapp/models/gallery.json', 'utf8'));
// `prepareGallery` recebe o objeto da galeria, não o mapa de assinaturas
const idx = G.prepareGallery(galeria);

console.log(`captura: ${CAPTURE.split('/').pop()} ${img.w}x${img.h}`);
console.log(`galeria: ${Object.keys(galeria.items).length} assinaturas`);
console.log(`geometria da galeria: x=${galeria.geom.x} y=${galeria.geom.y} size=${galeria.geom.size}\n`);

const px = img.canais === 4 ? 4 : 3;
let n = 0;
let acima90 = 0;
let acima85 = 0;
const linhas = [];

for (let r = 0; r < GRADE.rows; r++) {
  for (let c = 0; c < GRADE.cols; c++) {
    const cx = GRADE.x0 + c * GRADE.passo;
    const cy = GRADE.y0 + r * GRADE.passo;

    const rgb = Buffer.alloc(S * S * 3);
    for (let y = 0; y < S; y++) {
      const sy = cy + y;
      if (sy < 0 || sy >= img.h) continue;
      for (let x = 0; x < S; x++) {
        const sx = cx + x;
        if (sx < 0 || sx >= img.w) continue;
        const p = (sy * img.w + sx) * px;
        const d = (y * S + x) * 3;
        rgb[d] = img.data[p];
        rgb[d + 1] = img.data[p + 1];
        rgb[d + 2] = img.data[p + 2];
      }
    }

    const sig = G.signatureFromBatch(celulaParaBatch(rgb), S, 0, G.GALLERY_GRID);

    // varredura sem threshold: quero ver a distribuição, não o veredito
    let melhorId = null;
    let melhorScore = -1;
    let segundoScore = -1;
    for (const id of idx.ids) {
      const score = G.cosine(sig, G.decodeSignature(idx.items[id]));
      if (score > melhorScore) {
        segundoScore = melhorScore;
        melhorScore = score;
        melhorId = id;
      } else if (score > segundoScore) {
        segundoScore = score;
      }
    }

    n++;
    if (melhorScore > 0.9) acima90++;
    if (melhorScore > 0.85) acima85++;

    linhas.push({
      celula: n,
      id: melhorId ?? '—',
      score: melhorScore,
      margem: melhorScore - (segundoScore < 0 ? 0 : segundoScore),
    });
  }
}

console.log('cel  melhor item'.padEnd(42) + 'nota   margem');
console.log('-'.repeat(64));
for (const l of linhas) {
  console.log(
    String(l.celula).padStart(3) + '  ' +
      l.id.replace(/_/g, ' ').slice(0, 36).padEnd(38) +
      l.score.toFixed(4).padStart(6) + '   ' + l.margem.toFixed(4),
  );
}

console.log('-'.repeat(64));
console.log(`células: ${n}`);
console.log(`acima de 0.90: ${acima90}/${n}`);
console.log(`acima de 0.85: ${acima85}/${n}`);
