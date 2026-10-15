/**
 * O que o OCR devolve, de verdade, num inventario real.
 *
 * ## ## ## Por que este script existe
 *
 * Qualquer parser de contador e total comeca escrevendo regex contra um texto
 * que ninguem viu. O `ml/ler-total-raid.py` fez isso e leu `309` onde o jogo
 * escrevia `27.609` — e o problema nao foi a regex, foi o recorte: o numero
 * ocupava so a parte final da faixa e o resto era taken pela borda do painel.
 *
 * Nao ha como escrever o parser certo olhando o codigo. Este script captura a
 * tela do jogo, roda o mesmo OCR que o app usa e imprime palavra, caixa e
 * posicao — o unico jeito de saber emPT-BR, com o numero colado no texto, e o
 * que o motor devolve.
 *
 * ## Uso
 *
 *     node tools/ocr-real.mjs --painel mochila
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');
const ocr = require('@arcgx/ocr');

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

/** As mesmas frações de `apps/main/src/scan/panels.ts`, medidas em 1920x1080. */
const PAINEIS = {
  mochila: { label: 'MOCHILA', x: 1043, y: 271, w: 416, h: 520, cols: 4, rows: 5 },
  'uso-rapido': { label: 'USO RAPIDO', x: 1503, y: 271, w: 312, h: 208, cols: 3, rows: 2 },
  'bolso-seguro': { label: 'BOLSO SEGURO', x: 1503, y: 711, w: 312, h: 104, cols: 3, rows: 1 },
  armazenamento: { label: 'ARMAZENAMENTO', x: 152, y: 271, w: 416, h: 520, cols: 4, rows: 5 },
};

const painelNome = arg('painel', 'mochila');
const painel = PAINEIS[painelNome] ?? PAINEIS.mochila;

const invisiveis = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
const norm = (s) => {
  let out = '';
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0);
    if (invisiveis.has(cp)) continue;
    out += cp >= 0x2000 && cp <= 0x200a ? ' ' : cp === 0x202f || cp === 0x205f || cp === 0x3000 ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
};

const janelas = await cap.listWindows();
const jogo = janelas.find((w) => norm(w.title).toLowerCase().includes('arc') && norm(w.title).toLowerCase().includes('raider'));
if (!jogo) {
  console.error('janela do jogo nao encontrada; abra o inventario');
  process.exit(1);
}

cap.startCapture(jogo.hwnd);
await new Promise((r) => setTimeout(r, 1200));
const f = await cap.pollFrame();
if (!f || !f.width) {
  console.error('frame vazio');
  process.exit(1);
}
cap.stopCapture();

const W = f.width;
const H = f.height;
const ex = W / 1920;
const ey = H / 1080;
console.log(`frame ${W}x${H}  escala ${ex.toFixed(3)}x${ey.toFixed(3)}`);

const suporte = ocr.ocrSupport();
console.log(`OCR: ${suporte.available ? 'disponivel' : 'INDISPONIVEL — ' + suporte.reason}`);

function recorte(x, y, w, h) {
  const x0 = Math.max(0, Math.round(x * ex));
  const y0 = Math.max(0, Math.round(y * ey));
  const rw = Math.min(W - x0, Math.round(w * ex));
  const rh = Math.min(H - y0, Math.round(h * ey));
  const out = new Uint8Array(rw * rh * 4);
  for (let yy = 0; yy < rh; yy++) {
    const src = ((y0 + yy) * W + x0) * 4;
    out.set(f.data.subarray(src, src + rw * 4), yy * rw * 4);
  }
  return { pixels: out, width: rw, height: rh, x0, y0 };
}

/**
 * Regioes que interessam, todas em coordenadas de 1920x1080.
 *
 * O contador `x/y` fica **acima** da grade, na mesma faixa do titulo do
 * painel. O total da raid fica no cabecalho `ARMAMENTO`, a esquerda.
 */
const REGIOES = [
  { nome: 'cabecalho painel (x/y)', x: painel.x, y: painel.y - 34, w: painel.w, h: 34 },
  { nome: 'cabecalho ARMAMENTO', x: 700, y: 130, w: 700, h: 90 },
  { nome: 'painel inteiro', x: painel.x, y: painel.y, w: painel.w, h: painel.h },
];

const saida = {};
for (const r of REGIOES) {
  const rec = recorte(r.x, r.y, r.w, r.h);
  const res = ocr.recognize(rec.pixels, rec.width, rec.height);
  saida[r.nome] = res?.words ?? [];
  console.log(`\n=== ${r.nome}  (${rec.width}x${rec.height} em ${rec.x0},${rec.y0}) ===`);
  if (!res?.words?.length) {
    console.log('  (nenhuma palavra)');
    continue;
  }
  for (const w of res.words) {
    // Reemerge para coordenadas do frame: o overlay desenha nelas.
    console.log(
      `  "${w.text}" conf=${(w.confidence ?? 0).toFixed(2)} ` +
        `frame=(${Math.round(rec.x0 + w.x)},${Math.round(rec.y0 + w.y)}) ` +
        `tam=${Math.round(w.width)}x${Math.round(w.height)}`,
    );
  }
}

writeFileSync(
  'H:/Arcgxapp/dados/rotulo/ocr-real.json',
  JSON.stringify({ W, H, painel: painelNome, regioes: saida }, null, 2),
);
console.log('\n-> dados/rotulo/ocr-real.json');
console.log('   texto bruto:', JSON.stringify(Object.fromEntries(Object.entries(saida).map(([k, v]) => [k, (v ?? []).map((w) => w.text).join(' ')]))));