/**
 * Stella Montis não tem tile no slug que a referência usa.
 *
 * Duas saídas: achar o slug certo, ou assumir que o mapa não tem arte
 * publicada. Chutar slug em URL é barato — o 404 volta rápido — e o que não
 * pode é ficar com um mapa preto em produção achando que ele carregou.
 */

const CDN = 'https://cdn.arctracker.io/maps/tiles';

const CANDIDATOS = [
  'stella-montis',
  'stella-montis-upper',
  'stella-montis-lower',
  'stellaMontis',
  'stella_montis',
  'stella-montis-surface',
  'stella-montis-sublevel',
  'stella-montis-1',
  'stella-montis-v2',
  'stella',
];

for (const slug of CANDIDATOS) {
  const res = [];
  for (const [banda, z] of [
    ['low', 0],
    ['high', 2],
  ]) {
    const n = 2 ** z;
    const url = `${CDN}/${slug}/v2/${banda}/${z}/${Math.floor(n / 2)}/${Math.floor(n / 2)}.webp`;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      res.push(`${banda}z${z}:${r.status}`);
    } catch {
      res.push(`${banda}z${z}:ERR`);
    }
  }
  const serve = res.some((r) => r.endsWith('200'));
  console.log(`${slug.padEnd(26)} ${res.join('  ')}  ${serve ? '<< SERVE' : ''}`);
}

// e o que existe de fato na pasta de tiles?
for (const banda of ['low', 'high']) {
  for (const z of [0, 1, 2, 3]) {
    const url = `${CDN}/dam-battleground/v2/${banda}/${z}/0/0.webp`;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      console.log(`controle dam ${banda}z${z}: ${r.status}`);
    } catch {
      console.log(`controle dam ${banda}z${z}: ERR`);
    }
  }
}
