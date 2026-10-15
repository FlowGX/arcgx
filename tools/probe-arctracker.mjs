/**
 * Descobre o que o arctracker.io publica, em vez de raspar HTML.
 *
 * ## Por que sondar antes de usar
 *
 * A pagina de itens pode ter os nomes em portugues e a arte atual, mas da
 * para baixar isso de tres jeitos muito diferentes: um JSON publico, um
 * arquivo estatico, ou nada (e a arte estar embutida no bundle do site).
 *
 * O que muda a decisao:
 * - JSON publico -> pode entrar no ingest como fonte, com licenca e atribuicao
 * - arte so no bundle -> nao da para usar sem raspar, e raspar para produto
 *   e manutencao permanente, nao uma integracao
 * - nada -> ficamos com a MetaForge e so resolvemos a traducao
 */

const BASE = 'https://arctracker.io';

const CANDIDATOS = [
  '/api/items',
  '/api/items?locale=pt-BR',
  '/api/v1/items',
  '/pt-BR/items.json',
  '/data/items.json',
  '/items.json',
  '/api/arc-raiders/items',
  '/_next/data/pt-BR/items.json',
];

const H = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

for (const c of CANDIDATOS) {
  try {
    const r = await fetch(BASE + c, { headers: H });
    const tipo = r.headers.get('content-type') || '';
    const t = await r.text();
    const marca = tipo.includes('json') ? 'JSON' : tipo.split(';')[0];
    console.log(`${String(r.status).padEnd(4)} ${marca.padEnd(24)} ${c}  ${t.length}b`);
    if (tipo.includes('json') && t.length > 40) {
      console.log(`     ${t.slice(0, 220).replace(/\s+/g, ' ')}`);
    }
  } catch (e) {
    console.log(`ERR  ${c}  ${e.message.slice(0, 50)}`);
  }
}

// a pagina em si responde? e o que ela referencia?
try {
  const r = await fetch(`${BASE}/pt-BR/items`, { headers: H });
  const html = await r.text();
  console.log(`\n/pt-BR/items -> ${r.status}, ${html.length} bytes`);

  const fontes = [...new Set([...html.matchAll(/https?:\/\/[^"'\s)]+\.(?:json|webp|png)/gi)].map((m) => m[0]))];
  console.log(`urls de dado na pagina: ${fontes.length}`);
  fontes.slice(0, 12).forEach((u) => console.log('   ', u));

  const chaves = [...new Set([...html.matchAll(/"(name|displayName|name_pt|pt_br|portuguese)"/gi)].map((m) => m[1]))];
  console.log('chaves de nome encontradas:', chaves.join(', ') || '(nenhuma)');
} catch (e) {
  console.log('pagina:', e.message);
}