/**
 * ## ## ## O que este teste existe para impedir
 *
 * A lista de subcategorias cresce com o conteúdo do jogo, e uma sub nova
 * apareceria em inglês **sem nenhum aviso** — foi exatamente o que aconteceu
 * com as 182. Um teste que confere cobertura faz o próximo item novo falhar
 * alto em vez de vazar para a tela.
 *
 * Roda offline contra os dados publicados.
 */

import { readFileSync } from 'node:fs';
import { EVENTOS, GRUPOS, MAPA_POR_NOME_EVENTO, SUBS, coberturaSub, mapaDoEvento, nomeEvento, nomeGrupo, nomeSub } from '../packages/shared/dist/i18n.js';

const RAIZ = 'H:/Arcgxapp/dados/game';

let falhas = 0;
const falha = (msg) => {
  console.log(`  ERR ${msg}`);
  falhas++;
};

/* ------------------------------------------------------------ marcadores */

const markers = JSON.parse(readFileSync(`${RAIZ}/map-markers.json`, 'utf-8')).maps;
const subsPresentes = new Set();
for (const m of Object.values(markers)) for (const s of m.subs ?? []) subsPresentes.add(s);

const cob = coberturaSub(subsPresentes);
console.log(`subcategorias: ${cob.traduzidas}/${subsPresentes.size} traduzidas`);
if (cob.faltando.length) {
  console.log(`  faltando: ${cob.faltando.join(', ')}`);
  falha(`${cob.faltando.length} sub sem traducao`);
}

/* --------------------------------------------------------------- eventos */

const events = JSON.parse(readFileSync(`${RAIZ}/events.json`, 'utf-8')).events;
const tipos = new Set();
for (const v of Object.values(events)) tipos.add(String(v.id).split('@')[0]);

const semTrad = [...tipos].filter((t) => !EVENTOS[t]);
console.log(`eventos: ${tipos.size - semTrad.length}/${tipos.size} tipos traduzidos`);
for (const t of semTrad) falha(`evento sem traducao: ${t}`);

/* ----------------------------------------------------- mapa por nome curto */

const mapasRef = new Set();
for (const v of Object.values(events)) mapasRef.add(String(v.map ?? ''));
const semMapa = [...mapasRef].filter((m) => !mapaDoEvento(m));
console.log(`mapas referenciados: ${mapasRef.size - semMapa.length}/${mapasRef.size} resolvidos`);
for (const m of semMapa) falha(`mapa nao resolvido: ${m}`);

/* ------------------------------------------------- grupos e comportamento */

const gruposPresentes = new Set();
for (const m of Object.values(markers)) for (const g of m.groups ?? []) gruposPresentes.add(g);
const semGrupo = [...gruposPresentes].filter((g) => !GRUPOS[g]);
console.log(`grupos: ${gruposPresentes.size - semGrupo.length}/${gruposPresentes.size} traduzidos`);
for (const g of semGrupo) falha(`grupo sem traducao: ${g}`);

/**
 * Palavras que **são** iguais em português.
 *
 * `ARC` é sigla, `Piano` é"]: o mesmo nos dois idiomas. Sem esta lista o teste
 * acusaria a tabela de "traduzir nada", que é um falso positivo — pior que não
 * ter o teste, porque manda traduzir palavra por palavra e estraga o nome.
 */
const IGUAIS_PT = new Set([
  'agave', 'hurricane', 'matriarch', 'harvester', 'rollbot', 'espresso',
  'pop', 'tick', 'extraction', 'arc', 'piano', 'mistriarch',
]);

// pt-BR e en tem de diferir, senao a tabela "traduziu" nada.
for (const [k, v] of [...Object.entries(EVENTOS), ...Object.entries(GRUPOS), ...Object.entries(SUBS)]) {
  const base = k.trim().toLowerCase();
  if (v['pt-BR'] === v.en && !IGUAIS_PT.has(k) && !IGUAIS_PT.has(base)) {
    falha(`pt-BR identico a en: ${k} ("${v['pt-BR']}")`);
  }
}

// O nome exibido tem de sair em pt-BR e em en, conforme o idioma.
const ex = 'bird-city@1';
if (nomeEvento(ex, 'Bird City', 'pt-BR') !== 'Cidade das Aves') falha('nomeEvento pt-BR');
if (nomeEvento(ex, 'Bird City', 'en') !== 'Bird City') falha('nomeEvento en');
if (nomeSub('raider_cache', 'pt-BR') !== 'Depósito de Raider') falha('nomeSub pt-BR');
if (nomeGrupo('containers', 'pt-BR') !== 'Contêineres') falha('nomeGrupo pt-BR');

console.log(`\n${falhas === 0 ? 'ok' : 'FALHA'}: ${falhas} problema(s)`);
if (falhas) process.exit(1);