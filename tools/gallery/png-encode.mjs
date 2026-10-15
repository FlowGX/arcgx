/**
 * Codificador PNG mínimo (RGBA, sem filtro, zlib do node).
 *
 * O decodificador já existia em `build.mjs`; o que faltava era o caminho de
 * volta, para recortar as células de uma captura e salvar em disco — sem isso
 * o rótulo seria feito sobre prints de tela inteiros.
 */

import { deflateSync } from 'node:zlib';

const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([len, corpo, crc]);
}

/** `rgba` com `w*h*4` bytes -> Buffer PNG. */
export function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // cada linha com byte de filtro 0 (None)
  const bruto = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    bruto[y * (w * 4 + 1)] = 0;
    rgba.copy
      ? rgba.copy(bruto, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
      : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(bruto, y * (w * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Recorta `w`x`h` de um RGBA em (x, y). `img` é o retorno de `decodePng`. */
export function recortarRGBA(img, x, y, w, h) {
  const px = img.canais ?? 4;
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= img.h) continue;
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= img.w) continue;
      const s = (sy * img.w + sx) * px;
      const d = (j * w + i) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}
