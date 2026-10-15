/**
 * PNG minimo, sem dependencia.
 *
 * ## ## ## Por que existe
 *
 * O `recognize` do Tesseract, em Node, quer imagem **codificada** ou caminho.
 * Passar RGBA cru da `Error in findFileFormatStream: truncated file`: ele tenta
 * adivinhar o formato dos bytes, nao acha cabecalho e desiste. Em navegador o
 * mesmo `recognize` aceita canvas, e e por isso que o exemplo da documentacao
 * funciona la e falha aqui.
 *
 * Usado pelos probes de OCR. O app em si nao precisa disto: la o recorte
 * inteiro do jogo ja vai codificado.
 */

import { deflateSync } from 'node:zlib';

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, c]);
}

/**
 * @param {Uint8ClampedArray} rgba  w*h*4
 * @returns {Buffer} PNG RGBA
 */
export function rgbaParaPng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filtro "none"
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // cor verdadeira: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}