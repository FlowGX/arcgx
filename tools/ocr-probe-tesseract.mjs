/**
 * Tesseract noheader do jogo — teste com pré-processamento.
 *
 * ## ## ## Por que inverter
 *
 * A UI do ARC é **clara sobre escuro**: o `0/10` e o `2.000` sao quase brancos
 * num fundo azul-marinho. O Tesseract foi feito para tinta escura em papel
 * claro, e o LSTM que ele carrega foi treinado assim. Mandar o recorte como
 * esta devolve texto vazio ou besteira — e o motor tem alta confiança nos dois
 * casos, que e o pior formato de falha que existe.
 *
 * ## ## ## Por que upscale
 *
 * O texto tem ~9 px de altura. A 224 px de lado, cada glifo ocupa poucos pixels
 * e o classificador de linha nao tem o que medir. O upscale aqui e bicubico,
 * nao vizinho mais proximo: o `NEAREST` mantem o serrilhado e produz numeros
 * que se fundem.
 *
 * ## Uso
 *
 *     node tools/ocr-probe-tesseract.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker, PSM } from 'tesseract.js';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');

const RAIZ = 'H:/Arcgxapp';
const LANG_DIR = `${RAIZ}/apps/main/resources/ocr`;

const INVIS = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
const norm = (s) => {
  let o = '';
  for (const c of String(s ?? '')) {
    const p = c.codePointAt(0);
    if (INVIS.has(p)) continue;
    o += p >= 0x2000 && p <= 0x200a ? ' ' : p === 0x202f || p === 0x205f || p === 0x3000 ? ' ' : c;
  }
  return o.replace(/\s+/g, ' ').trim();
};

/* --------------------------------------------------------------- captura */

/**
 * ## Captura ao vivo ou arquivo?
 *
 * `--frame <arquivo.raw>` roda offline sobre uma captura ja salva, e `--todos`
 * varre todas. Isso nao e conveniencia: um teste que depende de o jogo estar
 * aberto com loot no inventario depende do momento, e as duas unicas coisas que
 * importam validar — `x/y` cheio e virgula decimal — so aparecem com loot.
 *
 * As 12 capturas em `dados/rotulo/raid/` sao o conjunto de regressao.
 */
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

async function capturarDe(raw) {
  if (raw) {
    const buf = readFileSync(raw);
    return { width: 1920, height: 1080, data: new Uint8Array(buf), origem: raw };
  }
  const janelas = await cap.listWindows();
  const alvo = janelas.find((j) => /arc\s*raiders/i.test(norm(j.title)));
  if (!alvo) {
    console.error('jogo nao aberto (use --frame <arquivo.raw> para rodar offline)');
    process.exit(1);
  }
  const v = cap.descreverProcesso(alvo);
  if (!v.ehJogo) {
    console.error('recusado:', v.motivo);
    process.exit(1);
  }
  cap.startCapture(alvo.hwnd);
  await new Promise((r) => setTimeout(r, 900));
  const fr = await cap.pollFrame();
  cap.stopCapture();
  return { width: fr.width, height: fr.height, data: fr.data, origem: `${v.nome}.exe ao vivo` };
}

const f = await capturarDe(arg('frame', null));
console.log(`fonte: ${f.origem}  ${f.width}x${f.height}`);

/* --------------------------------------------------------- pré-processar */

/** Recorta em coordenadas de 1920x1080 e devolve RGBA. */
function crop(x, y, w, h) {
  const ex = f.width / 1920;
  const ey = f.height / 1080;
  const X = Math.round(x * ex);
  const Y = Math.round(y * ey);
  const W = Math.round(w * ex);
  const H = Math.round(h * ey);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const s = ((Y + yy) * f.width + X + xx) * 4;
      const d = (yy * W + xx) * 4;
      out[d] = f.data[s + 2];
      out[d + 1] = f.data[s + 1];
      out[d + 2] = f.data[s];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

/** PNG minimo, so para gravar as variantes e olhar com o olho. */
function png(w, h, rgba) {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cbuf = Buffer.alloc(4);
    cbuf.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cbuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Escala por vizinho mais proximo, mantendo o serrilhado util ao binar. */
function upscale(src, w, h, k) {
  const W = w * k;
  const H = h * k;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < W; x++) {
      const sx = Math.floor(x / k);
      const s = (sy * w + sx) * 4;
      const d = (y * W + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

/** Luma e limiar: separa a tinta clara do fundo escuro. */
function binarizar(src, w, h, limiar) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const l = src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114;
    // branco = 255 quando a tinta for clara
    const v = l >= limiar ? 255 : 0;
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/** Preenche o fundo de preto com a mediana, como `ml/moldura.py` faz na barra. */
function preencherFundo(src, w, h) {
  const luminosas = [];
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const l = src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114;
    if (l > 150) luminosas.push(l);
  }
  luminosas.sort((a, b) => a - b);
  const limiar = luminosas.length ? luminosas[Math.floor(luminosas.length * 0.25)] : 180;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const l = src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114;
    const v = l >= limiar ? 255 : 0;
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/* --------------------------------------------------------------- regiões */

/**
 * Regioes medidas no frame real (`_hdr-armamento.png`, `_hdr-mochila.png`).
 *
 * O `x/y` de cada contêiner fica na linha do nome, alinhado a esquerda do
 * painel; o valor total da raid fica no cabecalho ARMAMENTO, ao lado do icone
 * de peso.
 */
const REGIOES = [
  { nome: 'mochila x/y', x: 1140, y: 226, w: 90, h: 30 },
  // O valor comeca antes de x=915: o recorte antigo pegava so ".000" e perdia
  // o primeiro digito. Margem generosa em X, estreita em Y — numero de
  // cabeçalho tem altura fixa e largura variavel.
  { nome: 'armamento valor largo', x: 880, y: 166, w: 140, h: 32 },
  { nome: 'armamento valor 2', x: 920, y: 166, w: 80, h: 32 },
  { nome: 'armamento peso', x: 785, y: 166, w: 135, h: 32 },
  { nome: 'uso-rapido x/y', x: 1600, y: 226, w: 90, h: 30 },
  // x=1570, nao 1600. Comeca em 1600 o motor le um caractere **antes** do
  // numero e devolve "00/3" para "0/3" — a capacidade do BOLSO SEGURO e 3, e
  // "00/3" nao bate com a grade. Medido em `tools/afinar-bolso.mjs`.
  { nome: 'bolso-seguro x/y', x: 1570, y: 658, w: 110, h: 30 },
];

/* ----------------------------------------------------------------- motor */

console.log(`\ntraineddata local: ${existsSync(path.join(LANG_DIR, 'eng.traineddata.gz')) ? 'ok' : 'AUSENTE'}`);

const worker = await createWorker('eng', 1, {
  langPath: LANG_DIR,
  cacheMethod: 'none',
  logger: () => {},
  errorHandler: (e) => console.error('tesseract:', e),
});

/**
 * Whitelist: so o que existe nesses campos.
 *
 * O `x/y` e o total sao numeros com virgula e ponto. Deixar o alfabeto inteiro
 * faz o motor "ler" letra onde nao tem nenhuma, e como o resultado vem com
 * confianca alta, o erro entra silencioso no overlay.
 */
await worker.setParameters({
  tessedit_char_whitelist: '0123456789/.,',
  tessedit_pageseg_mode: PSM.SINGLE_LINE,
  preserve_interword_spaces: '0',
});

/**
 * Variantes que valem a pena.
 *
 * As de limiar foram removidas depois de medida: com a tinta clara da UI sobre
 * fundo escuro, binarizar por percentis encontra limiar **dentro** do proprio
 * texto e apaga o numero. O recorte cru ja funciona — o modelo lete tanto
 * claro-sobre-escuro quanto o inverso, ao contrario do que se supunha.
 */
const VARIANTES = [
  { nome: 'cru', fn: (r) => r },
  { nome: 'invertido', fn: (r) => inverter(r) },
  { nome: 'up3 nearest', fn: (r) => upscale(r, r.width, r.height, 3) },
  { nome: 'preenchido+up4', fn: (r) => upscale(preencherFundo(r, r.width, r.height), r.width, r.height, 4) },
];

function inverter(r) {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let i = 0; i < r.width * r.height; i++) {
    const p = i * 4;
    out[p] = 255 - r.data[p];
    out[p + 1] = 255 - r.data[p + 1];
    out[p + 2] = 255 - r.data[p + 2];
    out[p + 3] = 255;
  }
  return { data: out, width: r.width, height: r.height };
}

let salvou = false;
for (const reg of REGIOES) {
  const base = crop(reg.x, reg.y, reg.w, reg.h);
  console.log(`\n=== ${reg.nome} (${base.width}x${base.height} em ${reg.x},${reg.y}) ===`);
  for (const v2 of VARIANTES) {
    const img = v2.fn(base);
    /**
     * Em Node o `recognize` quer imagem **codificada** (PNG/JPEG) ou caminho.
     * RGBA cru da "truncated file": o Tesseract tenta adivinhar o formato dos
     * bytes e nao acha cabecalho nenhum. Em navegador aceita canvas, e por isso
     * o exemplo da documentacao nao translate para Node.
     */
    const buf = png(img.width, img.height, img.data);
    const t0 = performance.now();
    const { data } = await worker.recognize(buf);
    const ms = performance.now() - t0;
    const txt = (data.text ?? '').trim().replace(/\s+/g, '');
    const conf = data.confidence ?? 0;
    console.log(`  ${v2.nome.padEnd(18)} "${txt}"  conf=${conf.toFixed(0)}  ${ms.toFixed(0)}ms`);
    if (!salvou && reg.nome === 'armamento valor' && v2.nome === 'preenchido+up4') {
      writeFileSync(`${RAIZ}/dados/rotulo/_ocr-var.png`, buf);
      salvou = true;
    }
  }
}

await worker.terminate();
console.log('\n-> dados/rotulo/_ocr-var.png (variante preprocessada)');
if (!existsSync(`${RAIZ}/dados/rotulo/_ocr-real.json`)) readFileSync;