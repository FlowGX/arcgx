/**
 * Teste in-game: captura a tela do jogo agora e conta a raid.
 *
 * ## Por que um script separado, e nao o app
 *
 * O app inteiro precisa estar aberto, com painel e overlay configurados, e
 * qualquer coisa travando nele impede o teste. A primeira vez que a
 * ferramenta toca o jogo de verdade nao pode ter quatro componentes no
 * caminho — tem que ter um, e ele tem que falar.
 *
 * Este caminho e: `wgc-capture` (iniciar / poll / encerrar) grava o frame,
 * e `ml/contar-live.py` recorta a grade e identifica. Sem Electron, sem
 * worker, sem overlay.
 *
 * ## ## ## O titulo do jogo vem com caractere invisivel entre as letras
 *
 * Codepoints reais da janela do jogo:
 *
 *     feff 0041 0052 0043  200b 200b 200b 2005  feff 0052 0061
 *     200b feff feff 200b 200b 200b 200b 200b  0069 0064 ...
 *
 * Sao as letras de "ARC Raiders", com U+200B (espaco zero) e U+FEFF (BOM)
 * entre cada uma — e o espaco do nome sendo **U+2005**, um espaco fino, nao
 * U+0020. Por isso `/arc\s*raiders/i` falhava com o jogo aberto: `\s` em
 * JavaScript nao casa com U+2005.
 *
 * A primeira tentativa de limpar usou `[-‍﻿]`, com hifen no inicio da
 * classe de caracteres. Isso vira um **intervalo** de U+002D ate U+200D e
 * deixa os invisiveis no lugar — o classico bug de classe de caractere que
 * comeca por `-`.
 *
 * `tools/rotulo/coletar.mjs` ja tinha esse `norm()` desde o comeco; nao
 * reutilizar aqui foi o erro.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const PAINEL = arg('painel', 'mochila');
const SAIDA = 'H:/Arcgxapp/dados/rotulo/raid';
const PY = 'H:/Arcgxapp/.venv-treino/Scripts/python.exe';

const INVISIVEL_CP = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);

/**
 * ## Por que filtrar por code point, e nao por regex
 *
 * Escrever a classe de caracteres com os invisiveis **literais** nao
 * funciona: o editor, o git e o shell normalizam U+200B para nada, e a
 * classe vira `[-]` ou similar — que e exatamente o bug que passou. Duas
 * tentativas assimaram: uma virou intervalo, outra nao removeu nada.
 *
 * Filtrando por `codePointAt` nao ha caractere invisivel no arquivo, so
 * numeros. Nao tem como corromper.
 */
const norm = (s) => {
  let out = '';
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0);
    if (INVISIVEL_CP.has(cp)) continue;
    // U+2000..U+200A sao espacos finos; U+202F e U+205F tambem. O titulo
    // do jogo usa U+2005 no lugar do espaco do nome.
    out += cp >= 0x2000 && cp <= 0x200a ? ' ' : cp === 0x202f || cp === 0x205f || cp === 0x3000 ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
};

mkdirSync(SAIDA, { recursive: true });

const janelas = await cap.listWindows();
/**
 * ## Por que a lista e positiva
 *
 * Antes era `find(/arc\s*raiders/i)` e pronto: um video sobre Arc Raiders no
 * YouTube, ou uma aba com o nome do jogo, casava e o script capturava o
 * navegador. Chegou a salvar 1920x1050 de pagina em branco e o `contar-live.py`
 * respondeu "0 celulas", sem nenhuma mensagem de que a janela estava errada.
 *
 * So `PioneerGame` passa, e janela sem processo legivel e reprovada — falhar
 * fechado. `ARC_GAME_PROCESSES` sobrescreve a lista se o executavel mudar.
 */
const alvo = (() => {
  const porTitulo = janelas.filter((j) => /arc\s*raiders/i.test(norm(j.title)));
  if (!porTitulo.length) return null;
  const veredito = (j) => cap.descreverProcesso?.(j);
  for (const j of porTitulo) {
    const v = veredito(j);
    if (!v || v.ehJogo) return j;
  }
  for (const j of porTitulo) {
    const v = veredito(j);
    console.error(`  recusada: ${v?.motivo ?? `processo de "${norm(j.title)}" nao verificado`}`);
  }
  console.error('captura recusada: nenhuma janela do jogo aprovada.');
  console.error('abra o ARC Raiders e rode de novo.');
  return null;
})();

if (!alvo) {
  console.error('janela do ARC Raiders nao encontrada.');
  console.error('\njanelas com area grande:');
  for (const j of janelas) {
    const r = j.rect;
    if (r && r.width > 400) console.error(`  "${norm(j.title)}"  ${r.width}x${r.height}`);
  }
  console.error('\nabra o jogo e a tela de INVENTARIO, e roda de novo.');
  process.exit(1);
}

console.log(`alvo: "${norm(alvo.title)}"  hwnd=${alvo.hwnd}  ${alvo.rect.width}x${alvo.rect.height}`);

/** `startCapture` devolve `void` — um retorno nao indica sucesso. */
try {
  cap.startCapture(alvo.hwnd);
} catch (e) {
  console.error('startCapture falhou:', e.message, '|', cap.lastD3DError?.());
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 700));

const f = cap.pollFrame();
cap.stopCapture();

if (!f || !f.width) {
  console.error('pollFrame devolveu frame vazio — o jogo esta minimizado?');
  process.exit(1);
}

const stamp = Date.now();
const raw = `${SAIDA}/live-${stamp}.raw`;
writeFileSync(raw, Buffer.from(f.data));
writeFileSync(
  `${SAIDA}/live-${stamp}.json`,
  JSON.stringify(
    { width: f.width, height: f.height, stride: f.stride ?? 4, canais: f.canais ?? 4 },
    null,
    2,
  ),
);
console.log(`frame: ${f.width}x${f.height}  stride=${f.stride ?? 4}  canais=${f.canais ?? 4}`);
console.log(`salvo: ${raw}`);

console.log('\ncontando...');
const r = spawnSync(PY, ['H:/Arcgxapp/ml/contar-live.py', raw, PAINEL], {
  encoding: 'utf-8',
  env: {
    ...process.env,
    ENCODER_SIDE: '224',
    ENCODER: process.env.ENCODER ?? 'H:/Arcgxapp/ml/modelo/encoder-arte.pt',
  },
});
process.stdout.write(r.stdout ?? '');
if (r.stderr) {
  const linhas = r.stderr.split('\n').filter((l) => !/Warning|onnxruntime|^\s*$/.test(l));
  if (linhas.length) process.stderr.write(linhas.join('\n') + '\n');
}
process.exit(r.status ?? 0);