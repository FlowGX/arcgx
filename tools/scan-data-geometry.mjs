import fs from 'node:fs';

const DIR = 'H:/Arcgxapp-ref/build/client/releases/5eba8915dffc8658/game';
const PATTERNS = [
  /"[a-zA-Z]*[Rr]esolution[a-zA-Z]*"/g,
  /"[a-zA-Z]*[Ss]creen[a-zA-Z]*"/g,
  /"[a-zA-Z]*[Ss]cale[a-zA-Z]*"/g,
  /"[a-zA-Z]*[Ww]idth[a-zA-Z]*"/g,
  /"[a-zA-Z]*[Hh]eight[a-zA-Z]*"/g,
  /"[a-zA-Z]*[Dd]isplay[a-zA-Z]*"/g,
  /"[a-zA-Z]*[Ii]con[a-zA-Z]*"/g,
  /"[a-zA-Z]*[Ii]nventory[a-zA-Z]*"/g,
];

for (const f of fs.readdirSync(DIR)) {
  const s = fs.readFileSync(`${DIR}/${f}`, 'utf8');
  const hits = new Set();
  for (const re of PATTERNS) for (const m of s.match(re) ?? []) hits.add(m);
  console.log(`${f.padEnd(22)} ${hits.size ? [...hits].join(', ') : 'nenhum campo de geometria/icone'}`);
}