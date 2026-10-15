/**
 * Jogadores online na Steam.
 *
 * ## Por que a API da Steam e não a do SteamDB
 *
 * O SteamDB não tem API pública: `/api/GetGraph` responde **410 Gone** e o
 * site fica atrás de Cloudflare. Raspá-lo seria depender de proteção contra
 * robô e depender do scraper continuar funcionando.
 *
 * A Steam publica o mesmo número em `ISteamUserStats/GetNumberOfCurrentPlayers`,
 * que é pública, oficial, não pede chave e não pede cadastro. É a mesma
 * métrica — e é a fonte que dá pra consultar a vontade.
 */

import { createLogger, type PlayerCount } from '@arcgx/shared';

const log = createLogger('players');

/** ARC Raiders. Confirmado via SearchApps da própria Steam. */
export const ARC_RAIDERS_APPID = '1808500';

const INTERVALO_MS = 5 * 60 * 1000;

export class PlayersService {
  private timer: NodeJS.Timeout | null = null;
  private ultimo: PlayerCount = {
    appid: ARC_RAIDERS_APPID,
    online: 0,
    fetchedAt: 0,
    ok: false,
  };
  private emVoo = false;

  constructor(private readonly aoMudar: (p: PlayerCount) => void) {}

  start(): void {
    if (this.timer) return;
    void this.buscar();
    this.timer = setInterval(() => void this.buscar(), INTERVALO_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get(): PlayerCount {
    return this.ultimo;
  }

  async buscar(forcar = false): Promise<PlayerCount> {
    // respecting rate limit: 5 min é o intervalo, e o botão só força se já
    // passou um minuto desde a última leitura
    if (this.emVoo) return this.ultimo;
    if (!forcar && Date.now() - this.ultimo.fetchedAt < 60_000) return this.ultimo;

    this.emVoo = true;
    try {
      const url =
        `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v0001/?appid=` +
        ARC_RAIDERS_APPID;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { response?: { player_count?: number; result?: number } };
      const n = j.response?.player_count;
      if (typeof n !== 'number') throw new Error('resposta sem player_count');

      this.ultimo = { appid: ARC_RAIDERS_APPID, online: n, fetchedAt: Date.now(), ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('contagem indisponível', msg);
      // mantém o último número bom: mostrar traço quando a rede falha é pior
      // do que mostrar um número um pouco velho
      this.ultimo = { ...this.ultimo, ok: false, erro: msg };
    } finally {
      this.emVoo = false;
    }
    this.aoMudar(this.ultimo);
    return this.ultimo;
  }
}
