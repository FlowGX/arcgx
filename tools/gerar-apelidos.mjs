/**
 * Gera o mapa de apelidos id-nosso -> id-arctracker, casando por **nome em ingles**.
 *
 * ## Por que gerado e nao escrito a mao
 *
 * 185 de 1.229 itens nao casam pelo id: nosso id usa hifen e sufixo `-recipe`
 * onde o deles usa underscore e `_blueprint`. Escrever 185 linhas a mao e
 * trabalho que o proximo item novo desfaz; e um erro de digitacao la dentro
 * traduz o item errado, que e pior do que nao traduzir.
 *
 * ## Por que nome, e nao similaridade
 *
 * O casamento e por nome em ingles **exato** (normalizado). "Sentinel Firing
 * Core" === "Sentinel Firing Core" identifica o item com certeza. Usar
 * distancia de string traria falso positivo com precisao — "Esquema de Fios"
 * e "Fios" tem nomes parecidos e sao itens diferentes.
 *
 * ## O que o mapa nao faz
 *
 * Nao adivinha. Se o nome nao bate exatamente, o item fica sem traducao e
 * aparece no relatorio. Um item sem PT e um inconvenience; o item errado com
 * PT e um bug.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CATALOGO = 'H:/Arcgxapp/dados/game/items.json';
const SAIDA = 'H:/Arcgxapp/dados/apelidos.json';

const H = { 'User-Agent': 'ArcGX/0.1', Accept: 'application/json' };

/** Tira acento e pontuacao, para o nome casar independente de idioma. */
function chave(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const canon = (s) => String(s ?? '').replace(/-/g, '_').toLowerCase();

/**
 * Confere que o casamento nao trocou o sentido de um modificador.
 *
 * ## O bug que motivou isto
 *
 * `football_shoes_green` tem nome **"Colorful Shoes (Red)"** na fonte do
 * arctracker — o id e o nome discordam entre si. Casando so pelo nome,
 * `colorful_shoes_green` (verde) casava com `football_shoes_red` (vermelho).
 * O mapa traduzia sapato verde como vermelho: silencioso, e pior que nao
 * traduzir.
 *
 * ## Onde a defesa tem que agir
 *
 * Comparar nome-com-nome nao pega isso: os dois lados dizem "green" porque o
 * nome remoto e que casa. O conflito esta entre **o id remoto e o nome
 * remoto** — `_green` no id contra "(Red)" no nome. E precisa ser contra
 * ambos os lados: nosso id tambem pode discordar do nosso nome.
 */
function conflita(id, nome) {
  const k = chave(nome);
  const modsNome = modificadores(k);
  if (!modsNome.length) return false;
  const modsId = modificadores(canon(id).replace(/_/g, ' '));
  if (!modsId.length) return false;
  // algum modificador do nome nao aparece no id
  return modsNome.some((x) => !modsId.includes(x));
}
const MODIFICADORES = [
  'green', 'red', 'blue', 'silver', 'gold', 'black', 'white', 'yellow', 'orange',
  'purple', 'pink', 'grey', 'gray', 'brown', 'cyan', 'magenta', 'violet',
];

function modificadores(chaveTexto) {
  const toks = new Set(chaveTexto.split(/[\s_]+/).filter(Boolean));
  return MODIFICADORES.filter((m) => toks.has(m));
}

const r = await fetch('https://arctracker.io/api/items', { headers: H });
const remoto = (await r.json()).items;

const nosso = JSON.parse(readFileSync(CATALOGO, 'utf8')).items;

// id do arctracker por nome em ingles
const porNome = new Map();
for (const i of remoto) {
  const k = chave(i.name?.en);
  if (k && !porNome.has(k)) porNome.set(k, i);
}
const idsRemotos = new Set(remoto.map((i) => i.id.toLowerCase()));

const mapa = {};
let jaCasa = 0;
let semPar = 0;
const semParDetalhe = [];
const recusados = [];

for (const [id, item] of Object.entries(nosso)) {
  const en = item.name?.en;
  if (!en) continue;
  const c = canon(id);
  if (idsRemotos.has(c)) {
    jaCasa++;
    continue;
  }
  const alvo = porNome.get(chave(en));
  if (!alvo) {
    semPar++;
    if (semParDetalhe.length < 25) semParDetalhe.push(`${c}  (en: ${en})`);
    continue;
  }
  // id e nome discordam em qualquer dos dois lados: o casamento seria um
  // erro silencioso (sapato verde virando vermelho)
  if (conflita(id, en) || conflita(alvo.id, alvo.name?.en)) {
    recusados.push(
      `${c} -> ${alvo.id}  (nosso "${en}" / id "${id}"; deles "${alvo.name?.en}" / id "${alvo.id}")`,
    );
    continue;
  }
  if (alvo.id.toLowerCase() !== c) {
    mapa[c] = alvo.id.toLowerCase();
  }
}

writeFileSync(SAIDA, JSON.stringify({ versao: 1, geradoEm: new Date().toISOString(), mapa }, null, 1), 'utf-8');

console.log(`casam por id  : ${jaCasa}`);
console.log(`apelidos novos: ${Object.keys(mapa).length}`);
console.log(`sem par        : ${semPar}`);
console.log(`recusados      : ${recusados.length}  (fonte incoerente)`);
if (recusados.length) {
  console.log('\nrecusados por conflito de cor:');
  recusados.forEach((x) => console.log('  ' + x));
}
if (semParDetalhe.length) {
  console.log('\namostra sem par:');
  semParDetalhe.forEach((x) => console.log('  ' + x));
}
console.log(`\n-> ${SAIDA}`);