/**
 * Confere se os tiles respondem de verdade, banda por banda.
 *
 * Assumir que a pirâmide está certa e esperar o Leaflet mostrar é esperar
 * descobrir por um mapa preto que a suposição estava errada. Cada mapa é
 * testado nos quatro níveis nativos, e um 404 aqui é a explicação mais
 * provável para "o mapa não deu certo".
 */

const CDN = 'https://cdn.arctracker.io/maps/tiles';

const SLUGS = {
  dam_battlegrounds: 'dam-battleground',
  buried_city: 'buried-city',
  the_spaceport: 'the-spaceport',
  the_blue_gate: 'blue-gate',
  riven_tides: 'riven-tides',
  pendola_pass: 'pendola-pass',
  stella_montis_upper: 'stella-montis',
  stella_montis_lower: 'stella-montis-lower',
};

for (const [id, slug] of Object.entries(SLUGS)) {
  const resultados = [];
  for (const [banda, z] of [
    ['low', 0],
    ['low', 1],
    ['high', 2],
    ['high', 3],
  ]) {
    const n = 2 ** z;
    const x = Math.floor(n / 2);
    const y = Math.floor(n / 2);
    const url = `${CDN}/${slug}/v2/${banda}/${z}/${x}/${y}.webp`;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      resultados.push(`${banda}z${z}:${r.status}`);
    } catch (e) {
      resultados.push(`${banda}z${z}:ERR`);
    }
  }
  const ruins = resultados.filter((r) => !r.endsWith('200')).length;
  console.log(
    `${id.padEnd(22)} ${slug.padEnd(20)} ${resultados.join('  ')}  ${ruins ? '<- FALHA' : ''}`,
  );
}
