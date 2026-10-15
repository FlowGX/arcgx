import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');

const INV = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);

/**
 * Mesma normalizacao de `tools/rotulo/contar-raid.mjs`.
 *
 * U+200B e ZERO WIDTH SPACE: 0x200B, e o intervalo que vira espaco e
 * 0x2000..0x200A — entao ele e **removido**, nao trocado por espaco. Trocar
 * por espaco parte "ARC Raiders" em "AR C R ai de rs" e a busca por titulo
 * deixa de casar com o jogo.
 */
const norm = (s) => {
  let o = '';
  for (const c of String(s ?? '')) {
    const p = c.codePointAt(0);
    if (INV.has(p)) continue;
    o += p >= 0x2000 && p <= 0x200a ? ' ' : p === 0x202f || p === 0x205f || p === 0x3000 ? ' ' : c;
  }
  return o.replace(/\s+/g, ' ').trim();
};

const w = await cap.listWindows();
const jogo = w.filter((x) => /arc\s*raiders/i.test(norm(x.title)));

console.log(`janelas cujo titulo casa: ${jogo.length}`);
for (const x of jogo) {
  const v = cap.descreverProcesso(x);
  console.log(`  "${norm(x.title)}"  pid=${x.pid}`);
  console.log(`    ehJogo=${v.ehJogo}  nome="${v.nome}"  motivo=${v.motivo ?? '(aprovado)'}`);
}

console.log('\namostra do que a lista POSITIVA recusa:');
let shown = 0;
for (const x of w) {
  const r = x.rect ?? {};
  if ((r.width ?? 0) < 800) continue;
  const v = cap.descreverProcesso(x);
  if (v.ehJogo) continue;
  console.log(`  ${String(v.nome || '(ilegivel)').padEnd(24)} ${String(v.motivo).slice(0, 66)}`);
  if (++shown >= 6) break;
}