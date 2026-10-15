import { useEffect, useState } from 'preact/hooks';

import type { PlayerCount } from '@arcgx/shared';

const api = window.arcgx.desktop;

/**
 * Jogadores online, no topo dos créditos.
 *
 * A fonte é a API oficial da Steam (`ISteamUserStats/GetNumberOfCurrentPlayers`),
 * que é pública e não pede chave. O SteamDB — que a gente queria no começo —
 * responde 410 em `/api/GetGraph` e fica atrás de Cloudflare: não tem API
 * para consumir, e raspá-lo seria depender de proteção contra robô.
 *
 * A leitura é automática a cada 5 min no main; o botão força uma releitura,
 * respeitando um piso de 1 min para não virar martelada em nenhuma direção.
 */
export function PlayersOnline() {
  const [p, setP] = useState<PlayerCount | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    let vivo = true;
    void api
      .playersCount()
      .then((x) => vivo && setP(x))
      .catch(() => {});
    const off = api.onPlayersCount((x) => vivo && setP(x));
    // só para o "há Xs" ficar vivo
    const t = window.setInterval(() => tick((n) => n + 1), 10_000);
    return () => {
      vivo = false;
      off();
      window.clearInterval(t);
    };
  }, []);

  async function atualizar() {
    setOcupado(true);
    try {
      setP(await api.playersRefresh());
    } finally {
      setOcupado(false);
    }
  }

  const idade = p?.fetchedAt ? Math.floor((Date.now() - p.fetchedAt) / 1000) : null;

  return (
    <div class="players">
      <div class="players-main">
        <span class="players-dot" data-ok={p?.ok ? '' : undefined} />
        <div>
          <div class="players-n">
            {p?.online ? p.online.toLocaleString('pt-BR') : '—'}
          </div>
          <div class="players-l">
            jogadores online agora
            {idade !== null ? ` · há ${idade < 60 ? `${idade}s` : `${Math.floor(idade / 60)}min`}` : ''}
          </div>
        </div>
      </div>

      <div class="players-side">
        <button type="button" class="btn ghost" onClick={() => void atualizar()} disabled={ocupado}>
          {ocupado ? 'lendo…' : 'atualizar'}
        </button>
        <div class="players-src">
          ARC Raiders · Steam
          <br />
          <a href="https://store.steampowered.com/app/1808500" onClick={(e) => {
            e.preventDefault();
            void api.openExternal('https://store.steampowered.com/app/1808500');
          }}>
            app 1808500
          </a>
          {p && !p.ok ? <div class="players-err">última leitura falhou</div> : null}
        </div>
      </div>
    </div>
  );
}
