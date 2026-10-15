/**
 * Exporta as células de uma captura para rotulagem.
 *
 * ## Por que isto precisa existir
 *
 * Treinar o embedder exige pares com a resposta certa: a mesma cômoda vista em
 * recortes diferentes, e ícones diferentes que precisam ficar longe um do
 * outro. Sem isso não há função de perda — só um chute com cara de modelo.
 *
 * O único jeito de obter essa verdade é o rótulo humano. E ele precisa vir no
 * formato exato que o treino consome: recorte por célula, com o id do item.
 * Rotular olhando a captura inteira na tela não serve, porque o recorte de 91
 * px é exatamente o que o classificador vai ver.
 *
 * A saída é deliberadamente burra — PNGs numerados e um JSON com o gabarito
 * em branco. A página `rotular.html` preenche, e o treino lê.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { decodePng } from '../gallery/build.mjs';
import { encodePng, recortarRGBA } from '../gallery/png-encode.mjs';

/**
 * Retângulos da grade, por captura.
 *
 * Medidos pelo `cell-vision` sobre cada captura real — a grade se move com a
 * resolução e a posição da janela do inventário, então fixar {x,y} no código
 * só funciona por acidente. `scan-worker-test.mjs` imprime estes valores.
 */
const GRADES = {
  'inventario-01.png': { cols: 4, rows: 5, x0: 154, y0: 378, passo: 104, lado: 91 },
  'inventario-02.png': { cols: 4, rows: 5, x0: 154, y0: 378, passo: 104, lado: 91 },
  'ao-vivo-01.png': { cols: 4, rows: 5, x0: 154, y0: 378, passo: 104, lado: 91 },
};

const CAPTURAS = 'H:/Arcgxapp-ref/captures';
const SAIDA = 'H:/Arcgxapp/dados/rotulo';
const CATALOGO = 'H:/Arcgxapp/dados/game/items.json';

/**
 * Catálogo embutido como JS, e não buscado em runtime.
 *
 * A página de rotulagem abre por `file://`, e `fetch` de `file://` é
 * bloqueado — o picker ficaria permanentemente vazio sem que nenhum erro
 * aparecesse no console para explicar. Gerar um `catalogo.js` com
 * `window.CATALOGO = [...]` contorna isso e funciona offline, que é o caso
 * real de uso.
 */
function escreverCatalogo() {
  if (!existsSync(CATALOGO)) {
    console.log('catálogo não encontrado, pulando');
    return;
  }
  const dados = JSON.parse(readFileSync(CATALOGO, 'utf8'));
  const lista = Object.values(dados.items ?? {})
    .filter((i) => i.id)
    .map((i) => ({
      id: i.id,
      // `pt-BR` e o que o ingest grava; `pt` e o fallback de outras fontes.
      // Sem os dois, a pagina de rotulagem abre em ingles e o usuario precisa
      // traduzir 1.200 celulas de cabeca.
      nome: i.name?.['pt-BR'] || i.name?.pt || i.name?.en || i.name || i.id,
      nomeEn: i.name?.en ?? undefined,
      raridade: i.rarity ?? null,
      img: i.imageFilename ?? null,
    }));

  mkdirSync(SAIDA, { recursive: true });
  const js = `window.CATALOGO = ${JSON.stringify(lista)};\n`;
  writeFileSync(join(SAIDA, 'catalogo.js'), js);
  console.log(`catálogo: ${lista.length} itens -> ${join(SAIDA, 'catalogo.js')}`);
}

escreverCatalogo();

const PAD = 12; // borda em volta do ícone, como a célula real tem

for (const [nome, g] of Object.entries(GRADES)) {
  const caminho = join(CAPTURAS, nome);
  if (!existsSync(caminho)) {
    console.log(`pula ${nome}: não existe`);
    continue;
  }

  const img = decodePng(readFileSync(caminho));
  const dir = join(SAIDA, nome.replace(/\.png$/, ''));
  mkdirSync(dir, { recursive: true });

  const gabarito = {};
  let n = 0;

  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const x = g.x0 + c * g.passo - PAD;
      const y = g.y0 + r * g.passo - PAD;
      const lado = g.lado + PAD * 2;
      const rgba = recortarRGBA(img, x, y, lado, lado);

      const id = String(n).padStart(2, '0');
      writeFileSync(join(dir, `${id}.png`), encodePng(rgba, lado, lado));
      gabarito[id] = { itemId: '', x, y, lado, indice: n };
      n++;
    }
  }

  writeFileSync(join(dir, 'gabarito.json'), JSON.stringify({ captura: nome, grade: g, celulas: gabarito }, null, 2));
  console.log(`${nome}: ${n} celulas -> ${dir}`);
}
