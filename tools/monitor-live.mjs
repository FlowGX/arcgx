/**
 * Monitor vivo do app.
 *
 * Roda em background e acompanha o log enquanto o app está aberto, marcando
 * o que interessa: erro de renderer (que antes não ia para lugar nenhum),
 * falha de IPC, e o ciclo do data-release. Subir isso a cada verificação
 * custava 50 s de sleep e não dizia nada — o monitor fica e eu leio quando quiser.
 *
 *   node monitor-live.mjs            # acompanha o log mais recente
 *   node monitor-live.mjs <segundos> # e encerra sozinho
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';

/**
 * O logger só escreve arquivo quando `ARC_LOG_DIR`/`ARC_LOG_FILE` está setado —
 * por padrão ele escreve só no console, que é por isso que subir o app e
 * esperar 50 s não rendia nada. O caminho padrão aqui é o mesmo que o app usa
 * quando roda com `ARC_LOG_DIR`.
 */
const DIR = process.env.ARC_LOG_DIR ?? 'C:/Users/Boxer/AppData/Local/Temp/opencode/arcgx-logs';
const ARQUIVO = `${DIR}/arcgx.log`;
const SEGUNDOS = Number(process.argv[2] ?? 0);

function maisRecente() {
  if (!existsSync(DIR)) return null;
  if (existsSync(ARQUIVO)) return ARQUIVO;
  const arquivos = readdirSync(DIR)
    .map((n) => ({ n, t: statSync(`${DIR}/${n}`).mtimeMs }))
    .filter((f) => f.n.endsWith('.log'))
    .sort((a, b) => b.t - a.t);
  return arquivos.length ? `${DIR}/${arquivos[0].n}` : null;
}

const INTERESSANTE = [
  /\[renderer\]/,
  /ERROR/,
  /catalogo|itens indexados|manifest|release pronto/,
  /events|agenda|players|contagem/i,
  /atualiza/i,
];

const MARCA = {
  '[renderer]': 'RENDER',
  ERROR: 'ERRO',
};

function linha(line) {
  const tag = Object.entries(MARCA).find(([k]) => line.includes(k))?.[1] ?? 'info';
  // tira o timestamp ISO inicial: o que importa é a mensagem
  const msg = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '');
  return `[${tag}] ${msg}`;
}

const arquivo = maisRecente();
if (!arquivo) {
  console.log('nenhum log em', DIR);
  process.exit(1);
}

console.log('monitorando', arquivo, SEGUNDOS ? `por ${SEGUNDOS}s` : '(Ctrl+C para sair)');

let pos = statSync(arquivo).size;
let timer = null;

function poll() {
  try {
    const st = statSync(arquivo);
    // o log rotaciona; recomeça do zero se encolheu
    if (st.size < pos) pos = 0;
    if (st.size === pos) return;
    const fd = readFileSync(arquivo, 'utf8').slice(pos);
    pos = st.size;
    for (const l of fd.split(/\r?\n/)) {
      if (!l.trim()) continue;
      if (INTERESSANTE.some((r) => r.test(l))) console.log(linha(l));
    }
  } catch {
    /* log trancado por outro processo: tenta no proximo tick */
  }
}

timer = setInterval(poll, 700);
poll();

if (SEGUNDOS) {
  setTimeout(() => {
    clearInterval(timer);
    console.log('--- monitor encerrado ---');
    process.exit(0);
  }, SEGUNDOS * 1000);
}
