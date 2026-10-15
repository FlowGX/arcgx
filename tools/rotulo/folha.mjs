/**
 * Folha de contato: as 20 células de uma captura em uma imagem só.
 *
 * Verificar recorte por recorte não escala, e estatística de luminância não
 * distingue "ícone escuro" de "pedaço do HUD". A única checagem que resolve é
 * olhar — e uma imagem com as 20 células lado a lado é o que permite.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodePng } from '../gallery/build.mjs';
import { encodePng } from '../gallery/png-encode.mjs';

const LOTE = 'H:/Arcgxapp/dados/rotulo/lote';
const SAIDA = 'H:/Arcgxapp/dados/rotulo/folhas';
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const ALVO = arg('captura', '');
const LIMITE = Number(arg('limite', 6));

mkdirSync(SAIDA, { recursive: true });

const idx = JSON.parse(readFileSync(join(LOTE, 'capturas.json'), 'utf8'));
const lista = ALVO ? idx.capturas.filter((c) => c.nome.includes(ALVO)) : idx.capturas.slice(0, LIMITE);

/** fundo claro para dar contraste com a UI escura */
const BG = [24, 21, 18];

for (const cap of lista) {
  const dir = join(LOTE, cap.nome);
  if (!existsSync(dir)) continue;

  const n = cap.celulas;
  const cols = 10;
  const linhas = Math.ceil(n / cols);
  const cel = 116;
  const gap = 4;
  const w = cols * cel + (cols + 1) * gap;
  const h = linhas * cel + (linhas + 1) * gap;

  const tela = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    tela[o] = BG[0];
    tela[o + 1] = BG[1];
    tela[o + 2] = BG[2];
    tela[o + 3] = 255;
  }

  for (let k = 0; k < n; k++) {
    const arq = join(dir, `${String(k).padStart(2, '0')}.png`);
    if (!existsSync(arq)) continue;
    const img = decodePng(readFileSync(arq));
    const c = k % cols;
    const r = Math.floor(k / cols);
    const ox = gap + c * (cel + gap);
    const oy = gap + r * (cel + gap);
    for (let j = 0; j < Math.min(cel, img.h); j++) {
      for (let i = 0; i < Math.min(cel, img.w); i++) {
        const s = (j * img.w + i) * img.canais;
        const d = ((oy + j) * w + (ox + i)) * 4;
        tela[d] = img.data[s];
        tela[d + 1] = img.data[s + 1];
        tela[d + 2] = img.data[s + 2];
        tela[d + 3] = 255;
      }
    }
  }

  const saida = join(SAIDA, `${cap.nome}.png`);
  writeFileSync(saida, encodePng(tela, w, h));
  console.log(`${cap.nome}: ${n} celulas -> ${saida}`);
}
