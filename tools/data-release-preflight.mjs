import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { DataRelease } = await import('../packages/shared/dist/data-release.js');

const BASE = 'file:///H:/Arcgxapp-ref/build/release/';
const root = path.join(os.tmpdir(), 'arcgx-preflight');

console.log('\n== preflight: data release local ==\n');
console.log(`  base: ${BASE}`);
console.log(`  root: ${root}\n`);

try {
  const release = await DataRelease.load({
    base: BASE,
    root,
    includeOptional: [],
    onProgress: (s) => {
      if (s.state !== (release?.state ?? s.state)) {
        /* imprime so transicoes relevantes */
      }
    },
  });
  console.log(`  manifest carregado, ${Object.keys(release.manifest?.files ?? {}).length} arquivos`);

  await release.sync();
  console.log('  sync concluido');

  const items = release.filePath('game/items.json');
  console.log(`  items.json: ${items}`);
  console.log(`  existe: ${(await import('node:fs')).existsSync(items)}`);
} catch (err) {
  console.log(`  FALHOU: ${err instanceof Error ? err.message : String(err)}`);
  console.log(`\n  (o app captura isso e mostra erro no painel — nao trava)\n`);
}