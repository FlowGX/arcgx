/**
 * Superfície do addon nativo de captura (Windows Graphics Capture).
 *
 * O grosso vem do `.node` compilado por napi-rs. O que está aqui em cima é
 * JavaScript puro, e existe por um motivo especifico: **descobrir qual
 * programa é dono de uma janela**, e recusar tudo que não for o jogo.
 *
 * ## ## ## Por que lista positiva e não negativa
 *
 * A primeira versão rejeitava navegador, chat e loja por nome. Isso segurava o
 * caso concreto que a motivou — um vídeo sobre Arc Raiders no YouTube faz o
 * título casar e o app capturar a aba — mas é uma lista negativa: **qualquer
 * executável novo passa**. O requisito é o oposto: captura só no executável do
 * ARC Raiders, nunca fora da janela dele.
 *
 * Uma negativa não implementa isso. Só a positiva implementa.
 *
 * ## ## ## Por que nome de processo e não caminho
 *
 * Tentado primeiro: `Get-Process.Path` e `Win32_Process.ExecutablePath` para o
 * PID do jogo devolvem **string vazia**, porque o `PioneerGame.exe` roda
 * elevado e este processo não. O nome continua legivel pelo `tasklist`, então e
 * pelo nome que a verificação é feita. Quando o caminho está disponivel, ele é
 * conferido tambem — mas nunca é requisito.
 *
 * ## ## ## Falhar fechado
 *
 * Sem nome de processo legivel, a janela e reprovada. A alternativa — aceitar
 * por fallback no titulo — e exatamente o furo que trouxe o Firefox para o
 * lugar do jogo. Preferimos o overlay parado a ler a tela errada.
 */

const { execFileSync } = require('node:child_process');

/**
 * Executáveis que podem conter o jogo.
 *
 * `PioneerGame.exe` é o binário real, em
 * `E:\SteamLibrary\steamapps\common\Arc Raiders\PioneerGame.exe`.
 *
 * `ARC_GAME_PROCESSES` sobrescreve quando o jogo mudar de nome — um patch
 * pode trocar o executavel, e neste caso o app deve falhar visivelmente em vez
 * de silenciosamente parar de capturar.
 */
const PROCESSOS_DO_JOGO = new Set(
  (process.env.ARC_GAME_PROCESSES ?? 'PioneerGame')
    .split(/[,;\s]+/)
    .map((s) => s.replace(/\.exe$/i, '').trim().toLowerCase())
    .filter(Boolean),
);

/** Janela menor que isso nao tem onde a grade do inventario estar. */
const TAMANHO_MINIMO = { largura: 640, altura: 360 };

/** pid -> nome do executavel. `null` ate a primeira chamada. */
let _porPid = null;

/**
 * Mapa pid -> nome, por uma unica chamada ao `tasklist`.
 *
 * Se o `tasklist` falhar, devolve mapa vazio em vez de lancar. Com o mapa
 * vazio nada passa na verificacao e a captura para — que e o comportamento
 * desejado, e o motivo de o log reclamar disso explicitamente.
 */
function processNames() {
  if (_porPid) return _porPid;
  _porPid = new Map();
  try {
    const saida = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'latin1',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const linha of saida.split(/\r?\n/)) {
      const m = linha.match(/^"([^"]*)","(\d+)"/);
      if (m) _porPid.set(Number(m[2]), m[1].replace(/\.exe$/i, ''));
    }
  } catch {
    _porPid = new Map();
  }
  return _porPid;
}

/** Nome do executavel dono da janela, ou string vazia se nao der para saber. */
function windowProcessName(w) {
  if (!w || !w.pid) return '';
  return processNames().get(Number(w.pid)) ?? '';
}

/**
 * Veredito sobre a janela, com o motivo.
 *
 * O motivo existe para o log: "captura recusada" sem explicação obriga o
 * usuario a adivinhar, e adivinhar sobre captura de tela dáworkaround errado
 * com muita frequencia.
 */
function descreverProcesso(w) {
  if (!w) return { nome: '', ehJogo: false, motivo: 'janela inexistente' };

  const nome = windowProcessName(w);
  if (!nome) {
    return {
      nome: '',
      ehJogo: false,
      motivo:
        `processo do pid ${w.pid} ilegivel (o jogo roda elevado? ` +
        `ou o tasklist falhou)`,
    };
  }

  if (!PROCESSOS_DO_JOGO.has(nome.toLowerCase())) {
    return {
      nome,
      ehJogo: false,
      motivo: `processo "${nome}" nao e o jogo (esperado: ${[...PROCESSOS_DO_JOGO].join(', ')})`,
    };
  }

  const r = w.rect;
  if (r && (r.width < TAMANHO_MINIMO.largura || r.height < TAMANHO_MINIMO.altura)) {
    return {
      nome,
      ehJogo: false,
      motivo: `janela do jogo pequena demais: ${r.width}x${r.height}`,
    };
  }

  return { nome, ehJogo: true, motivo: null };
}

/** atalho: a janela pode ser o jogo? */
function isPlausiblyGame(w) {
  return descreverProcesso(w).ehJogo;
}

/** Invalida o cache de processos. */
function resetProcessCache() {
  _porPid = null;
}

module.exports = {
  processNames,
  windowProcessName,
  descreverProcesso,
  isPlausiblyGame,
  resetProcessCache,
  PROCESSOS_DO_JOGO,
};