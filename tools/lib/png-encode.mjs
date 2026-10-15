/**
 * Codificador PNG minimo, sem dependencia.
 *
 * Existe para fechar o ciclo de diagnostico: capturar um frame real do jogo,
 * gravar em disco e rodar as mesmas ferramentas de medida que rodam sobre as
 * capturas de referencia. Sem isso, todo bug de geometria so aparece como
 * "0 classificados", sem nenhuma evidencia para investigar.
 *
 * Escreve RGBA de 8 bits, filtro 0 por linha, um unico IDAT com zlib.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {Uint8Array|Buffer} rgba  pixels em RGBA, `width*height*4` bytes
 * @returns {Buffer} PNG completo
 */
export function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    Buffer.from(rgba.buffer ?? rgba, rgba.byteOffset ?? 0, rgba.length).copy(
      raw,
      y * (stride + 1) + 1,
      y * stride,
      y * stride + stride,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}