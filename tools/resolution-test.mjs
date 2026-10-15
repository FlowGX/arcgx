#!/usr/bin/env node
/**
 * O detector e independente de resolucao?
 *
 * A geometria foi medida em 1920x1080 (celula 96x104, passo 104). Se o jogo
 * roda em outra resolucao e o detector so funciona em 1920x1080, a calibracao
 * virou hardcode — e o app quebra para qualquer usuario fora dela.
 *
 * Aqui a captura e reescalada por reamostragem bilinear (como o renderizador
 * faria) e o detector e rodado com a ROI escalada na mesma proporcao. O que
 * precisa valer: mesma grade e celulas com proporcao preservada.
 *
 *   node tools/resolution-test.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { decodePng } from './lib/png.mjs';
import { encodePng } from './lib/png-encode.mjs';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');

// ROI medida em 1920x1080
const BASE_W = 1920, BASE_H = 1080;
const ROI = { x: 152, y: 367, width: 416, height: 624 };
// geometria esperada, em 1920x1080
const REF = { x: 152, y: 367, w: 96, h: 104, pitch: 104 };

const SCALES = [1.0, 1.25, 1.3333, 0.8333, 0.6667, 0.5];

function resize(src, sw, sh, dw, dh) {
  const out = Buffer.allocUnsafe(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(sh - 1, y0 + 1));
    const wy = fy - Math.floor(fy);
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(sw - 1, x0 + 1));
      const wx = fx - Math.floor(fx);
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c];
        const p01 = src[(y0 * sw + x1) * 4 + c];
        const p10 = src[(y1 * sw + x0) * 4 + c];
        const p11 = src[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p01 - p00) * wx;
        const bot = p10 + (p11 - p10) * wx;
        out[o + c] = Math.round(top + (bot - top) * wy);
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

const img = decodePng(fs.readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const rgba = Buffer.allocUnsafe(img.data.length);
for (let i = 0; i < img.data.length; i += 4) {
  rgba[i] = img.data[i]; rgba[i + 1] = img.data[i + 1]; rgba[i + 2] = img.data[i + 2]; rgba[i + 3] = 255;
}

console.log('\n== detector em varias resolucoes ==\n');
console.log('  escala   resolucao      grade   celula medida              esperado (x s, y s, w s, h s)   erro');

for (const s of SCALES) {
  const dw = Math.round(BASE_W * s);
  const dh = Math.round(BASE_H * s);
  const scaled = s === 1 ? rgba : resize(rgba, BASE_W, BASE_H, dw, dh);

  // BGRA para o addon
  const bgra = Buffer.allocUnsafe(scaled.length);
  for (let i = 0; i < scaled.length; i += 4) {
    bgra[i] = scaled[i + 2]; bgra[i + 1] = scaled[i + 1]; bgra[i + 2] = scaled[i]; bgra[i + 3] = 255;
  }

  const roi = {
    x: Math.round(ROI.x * s), y: Math.round(ROI.y * s),
    width: Math.round(ROI.width * s), height: Math.round(ROI.height * s),
  };

  // Configuracao tambem escalada: as tolerancias do detector sao em px
  // absolutos (pad, min_cell, agrupamento de residuos), e celula de 48 px numa
  // tela de 960x540 e um problema diferente de celula de 96 px em 1920x1080.
  const cfg = {
    edgeThreshold: 0.22, minCell: 16 * s, maxCell: 400 * s,
    bandEnergy: 0.45, mergeGap: 5 * s, refine: true, padPx: 8 * s,
  };

  const b = vision.prepareClassifierBatch(bgra, dw, dh, roi, 96, cfg);
  const c = b.cells[0];

  if (!c) {
    console.log(`  ${s.toFixed(3).padStart(5)}   ${String(dw + 'x' + dh).padEnd(12)}  ${b.cols}x${b.rows}`.padEnd(70) + 'FALHOU: nenhuma celula');
    continue;
  }

  const ex = REF.x * s, ey = REF.y * s, ew = REF.w * s, eh = REF.h * s;
  const err = Math.max(
    Math.abs(c.x - ex), Math.abs(c.y - ey),
    Math.abs(c.width - ew), Math.abs(c.height - eh),
  );
  const ok = b.cols === 4 && b.rows === 5 && err <= 4;
  console.log(
    `  ${s.toFixed(3).padStart(5)}   ${String(dw + 'x' + dh).padEnd(12)}  ${b.cols}x${b.rows}`.padEnd(24) +
    `  ${(c.x.toFixed(0) + ',' + c.y.toFixed(0) + ' ' + c.width.toFixed(0) + 'x' + c.height.toFixed(0)).padEnd(24)}` +
    `  ${(ex.toFixed(0) + ',' + ey.toFixed(0) + ' ' + ew.toFixed(0) + 'x' + eh.toFixed(0)).padEnd(28)}` +
    `  ${err.toFixed(1)}px  ${ok ? 'OK' : 'DIVERGE'}`,
  );

}

console.log('\n== calibrate() por resolucao ==\n');
console.log('  escala   resolucao      pitch   celula      origem        cols x rows derivadas   esperado 4x5');

for (const s of SCALES) {
  const dw = Math.round(BASE_W * s);
  const dh = Math.round(BASE_H * s);
  const scaled = s === 1 ? rgba : resize(rgba, BASE_W, BASE_H, dw, dh);
  const bgra = Buffer.allocUnsafe(scaled.length);
  for (let i = 0; i < scaled.length; i += 4) {
    bgra[i] = scaled[i + 2]; bgra[i + 1] = scaled[i + 1]; bgra[i + 2] = scaled[i]; bgra[i + 3] = 255;
  }
  const roi = {
    x: Math.round(ROI.x * s), y: Math.round(ROI.y * s),
    width: Math.round(ROI.width * s), height: Math.round(ROI.height * s),
  };
  const cfg = {
    edgeThreshold: 0.22, minCell: 16 * s, maxCell: 400 * s,
    bandEnergy: 0.45, mergeGap: 5 * s, refine: true, padPx: 8 * s,
  };

  const spec = vision.calibrate(bgra, dw, dh, roi, cfg);
  if (!spec) {
    console.log(`  ${s.toFixed(3).padStart(5)}   ${(dw + 'x' + dh).padEnd(12)}  calibrate() devolveu null`);
    continue;
  }

  // grade derivada do pitch + origem, como o app faria com o cache.
  // Contar por iteracao e nao por division: a divisao erra em um quando a
  // ultima celula preenche o resto da ROI exatamente (medido em 2400x1350).
  const fits = (n) => {
    let k = 0;
    while (k < 64 && spec.originX + k * spec.pitch + spec.cellWidth <= roi.width + 1) k++;
    const m = 0;
    let j = 0;
    while (j < 64 && spec.originY + j * spec.pitch + spec.cellHeight <= roi.height + 1) j++;
    return { cols: k, rows: j, n };
  };
  const { cols, rows } = fits();
  const pitchErro = Math.abs(spec.pitch - REF.pitch * s);
  const ok = cols === 4 && rows === 5;
  console.log(
    `  ${s.toFixed(3).padStart(5)}   ${(dw + 'x' + dh).padEnd(12)}  ` +
    `${spec.pitch.toFixed(1).padStart(5)}   ` +
    `${(spec.cellWidth.toFixed(0) + 'x' + spec.cellHeight.toFixed(0)).padEnd(11)}  ` +
    `${(spec.originX.toFixed(0) + ',' + spec.originY.toFixed(0)).padEnd(13)}  ` +
    `${String(cols + ' x ' + rows).padEnd(16)}  ` +
    `4 x 5   ${ok ? 'OK' : 'DIVERGE (pitch erro ' + pitchErro.toFixed(1) + 'px)'}`,
  );
}