/**
 * Fonte: arctracker.io — nomes em portugues e arte atualizada.
 *
 * ## O que ela resolve
 *
 * Rotular as 1.200 celulas em ingles e lento porque o catalogo expoe nome
 * em ingles. Esta fonte traz `name.pt-BR` e `description.pt-BR` para 985
 * itens, incluindo os 400 da versao 2.0 (Frozen Trail) — arte e nome que
 * ja estavam desatualizados no nosso catalogo.
 *
 * ## O problema do separador
 *
 * Nosso catalogo usa HIFEN no id (`acoustic-guitar`, `action-economy`); o
 * arctracker usa UNDERSCORE (`acoustic_guitar`, `action_economy`). Sem
 * normalizar, o casamento dava so 58 de 1.113 — e parecia que as fontes nao
 * tinham nada em comum. Normalizando o separador, casam 769. O id do
 * arctracker e o canonico; o nosso vira o derivado.
 *
 * ## Atribuicao
 *
 * O site tem API publica com `/api/items`. Usamos leitura, nunca
 * redistribuicao do arte deles em bulk alem do cache de rotulagem — o app
 * consome a arte pela CDN deles, como ja faz com os tiles do mapa.
 */

import { readFileSync } from 'node:fs';

import { fetchJson, log, text } from '../lib/normalize.mjs';

const BASE = 'https://arctracker.io';

export const id = 'arctracker';
export const name = 'ARC Tracker (arctracker.io)';
export const homepage = 'https://arctracker.io/pt-BR/items';
export const license = 'API pública — leitura, cache local';

export const attribution = {
  id,
  name,
  homepage,
  license,
  required: true,
  notice:
    'Item names, descriptions and art from the public ARC Tracker API, a community project. Art served from their CDN.',
  link: 'https://arctracker.io',
  dataCopyright: 'Game content © Embark Studios AB. Not affiliated with Embark Studios.',
};

/**
 * `acoustic-guitar` -> `acoustic_guitar`. O id do arctracker e o canonico.
 *
 * ## O sufixo de tier tambem conta
 *
 * Nosso id e `bantam`; o do arctracker e `bantam_i`. Sem o sufixo, o item
 * nao casa e fica sem traducao — e sao justamente os itens novos, que e o
 * que mais importa traduzir. A regra e so acrescentar o sufixo quando o
 * item **nao** existe sem ele, para nao criar id fantasma para quem ja casa.
 */
function canonico(s) {
  return String(s ?? '').replace(/-/g, '_').toLowerCase();
}

const SUFIXO_TIER = new Set(['i', 'ii', 'iii', 'iv', 'v']);

/**
 * `pt-BR` e preferivel a `pt` (pt-BR tem a forma brasileira); o `en` fica
 * como plano B para itens que so tem ingles — melhor um nome em ingles do
 * que o id cru.
 */
function nomePt(item) {
  const n = item?.name;
  if (!n) return undefined;
  return n['pt-BR'] || n.pt || n.en;
}

/**
 * Todas as formas que um item pode ter na fonte, da mais provavel para a
 * menos. `bantam` testa tambem `bantam_i` porque e assim que o arctracker
 * grava; `bantam_i` ja casa direto.
 *
 * ## O `_part`
 *
 * Nosso id e `sentinel-part`; o do arctracker e `sentinel_firing_core`.
 * Nao ha como canonizar isso — `part` e `firing_core` sao palavras diferentes
 * — e o item ficava sem traducao, com o usuario parado na frente de
 * "Nucleo de Disparo de Sentinela" inexistente na lista.
 *
 * Nao da para resolver por regex sem inventar. A saida correta e um mapa
 * curado, escrito a mao quando o casamento automatico falha, com o id de cada
 * lado. Ele e pequeno e cada entrada tem um motivo.
 */
const APELIDOS = {
  // id nosso -> id no arctracker
  'sentinel-part': 'sentinel_firing_core',
};

/**
 * Apelidos gerados, casados por nome em ingles exato.
 *
 * 185 dos 1.229 itens nao casam pelo id: nosso usa `-recipe` onde o deles usa
 * `_blueprint`, entre outras diferencas. O mapa vem de `tools/gerar-apelidos.mjs`
 * e e **dado**, nao codigo — escrever 185 linhas a mao e trabalho que o
 * proximo item novo desfaz, e um erro de digitacao traduz o item errado.
 */
const APELIDOS_GERADOS = (() => {
  try {
    const arq = new URL('../../../dados/apelidos.json', import.meta.url);
    return JSON.parse(readFileSync(arq, 'utf8'))?.mapa ?? {};
  } catch {
    // Sem o arquivo, so valem os apelidos curados acima. O ingest nao quebra:
    // itens sem traducao sao um inconveniente, item errado e um bug.
    return {};
  }
})();

function chavesDeCasamento(id) {
  const c = canonico(id);
  const partes = c.split('_');
  const ultima = partes[partes.length - 1];
  const saida = [c];
  const gerado = APELIDOS_GERADOS[c];
  if (gerado) saida.push(gerado);
  const apelido = APELIDOS[c];
  if (apelido) saida.push(apelido);
  if (!SUFIXO_TIER.has(ultima)) {
    saida.push(`${c}_i`);
  }
  return saida;
}

export async function items() {
  const res = await fetchJson(`${BASE}/api/items`, { retries: 2 });
  const linhas = res?.items ?? [];
  const out = {};
  // indice por nome curto, para o casamento com sufixo
  const porCurto = new Map();
  for (const it of linhas) {
    if (it?.id) porCurto.set(it.id.replace(/_(i|ii|iii|iv|v)$/, ''), it);
  }

  let comPt = 0;
  for (const it of linhas) {
    if (!it?.id) continue;
    const nome = nomePt(it);
    if (nome) comPt++;
    out[canonico(it.id)] = {
      id: canonico(it.id),
      // o campo `name` do nosso schema e texto; a traducao vai em `namePt`
      name: nome ?? it.id,
      nameEn: it.name?.en ?? undefined,
      namePt: nome ?? undefined,
      descricao: text(it.description?.['pt-BR'] || it.description?.pt || it.description?.en),
      imagem: it.imageFilename ?? undefined,
      // `addedIn` = versao em que o item entrou. Serve para saber o que e
      // novo (Frozen Trail = 2.0) sem adivinhar pelo nome.
      versao: it.addedIn ?? undefined,
      atualizadoEm: it.updatedAt ?? undefined,
      _source: id,
    };
  }

  const novos = linhas.filter((i) => i.addedIn === '2.0').length;
  log(id, `${Object.keys(out).length} itens, ${comPt} com nome pt, ${novos} da versao 2.0`);
  return out;
}

/**
 * Busca o item para um id do nosso catalogo, aceitando o sufixo de tier.
 *
 * Retorna `null` quando nao casa em nenhuma forma — e o certo, porque
 * forcar um casamento errado traduz o item errado, que e pior que nao
 * traduzir.
 */
export function buscar(catalogo, id) {
  for (const chave of chavesDeCasamento(id)) {
    if (catalogo[chave]) return catalogo[chave];
  }
  return null;
}