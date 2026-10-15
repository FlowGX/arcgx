/**
 * Descobre as rotas de mapa do MetaForge em vez de chutar.
 *
 * Adivinhar `/api/arc-raiders/<palavra>` dá 404 e um HTML de erro, que parece
 * "não existe endpoint" quando na verdade só mudou o nome. A página do mapa é
 * a fonte: o Next.js embute nela o nome das rotas que a tela usa.
 */

const H = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const alvo = process.argv[2] ?? 'https://metaforge.app/arc-raiders/map';

const r = await fetch(alvo, { headers: H });
const t = await r.text();
console.log(`${r.status} ${alvo} -> ${t.length} bytes\n`);

const achados = (re, titulo) => {
  const set = [...new Set([...t.matchAll(re)].map((m) => m[1]))];
  console.log(`--- ${titulo} (${set.length}) ---`);
  set.slice(0, 40).forEach((x) => console.log('  ', x));
  console.log();
  return set;
};

achados(/\/api\/[a-zA-Z0-9/_-]+/g, 'rotas /api');
achados(/tableID[^a-zA-Z0-9]{0,8}["'`]([A-Za-z0-9_-]{2,40})["'`]/g, 'tableID');
achados(/tableId[^a-zA-Z0-9]{0,8}["'`]([A-Za-z0-9_-]{2,40})["'`]/gi, 'tableId');
achados(/["'`]([a-z][a-zA-Z0-9]{3,30}?)(?:Markers|Pins|Nodes|POI|Points)["'`]/g, 'nomes de camada');
achados(/["'`][a-z0-9-]{4,40}["'`]\s*[:,]\s*\{[^{}]{0,80}?(?:lat|lng|lon|x|y)\s*:/gi, 'objetos com coordenada');
