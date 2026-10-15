import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import type {
  AppConfig,
  AttributionFile,
  CorrectionReport,
  Entitlement,
  PremiumFeatures,
} from '@arcgx/shared';
import '@arcgx/design/tokens.css';
import '@arcgx/design/components.css';
import './app.css';

import { Dashboard } from './views/dashboard';
import { setIdioma } from './lib/data';
import { Items } from './views/items';
import { Needs } from './views/needs';
import { Quests } from './views/quests';
import { Projects, Research } from './views/projects';
import { Raids, Stash } from './views/game';
import { OverlayPage } from './views/overlay-page';
import { EventsLive } from './views/events-live';
import { MapsPage } from './views/maps';
import { GameUpdateNotice } from './views/update-notice';
import { PlayersOnline } from './components/players-online';
import { ErrorBoundary } from './components/error-boundary';

const api = window.arcgx.desktop;

/* ------------------------------------------------------------- créditos */

function Credits() {
  const [file, setFile] = useState<AttributionFile | null>(null);
  useEffect(() => {
    void api.getCredits().then(setFile).catch(() => setFile(null));
  }, []);

  return (
    <>
      <div class="page-head">
        <div class="h2">Créditos e origem dos dados</div>
        <div class="muted">
          Os dados de itens vêm de fontes comunitárias com licença aberta. O
          reconhecê-las é condição de uso, não cortesia.
        </div>
      </div>

      <PlayersOnline />

      {!file ? (
        <div class="card">
          <div class="empty">
            <div class="empty-title">Arquivo de atribuição indisponível</div>
            <div class="empty-hint">
              Ele vem junto da release de dados. Se a base não carregou, o
              arquivo também não veio.
            </div>
          </div>
        </div>
      ) : (
        <div class="card">
          {(file.sources ?? []).map((s) => (
            <div key={s.id} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--gx-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong style={{ fontWeight: 500 }}>{s.name}</strong>
                <span class="badge">{s.license ?? '—'}</span>
              </div>
              <div class="muted mono" style={{ fontSize: 11, marginTop: 3 }}>
                {s.homepage}
              </div>
              {s.notice ? (
                <p class="muted" style={{ marginTop: 7, lineHeight: 1.6 }}>
                  {s.notice}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- conta */

function Account() {
  const [entitlement, setEntitlement] = useState<{
    entitlement: Entitlement;
    features: PremiumFeatures;
  } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState<CorrectionReport[] | null>(null);

  const refresh = useCallback(() => {
    void api.getEntitlement().then(setEntitlement).catch(() => setEntitlement(null));
    void api.getPending().then(setPending).catch(() => setPending([]));
  }, []);

  useEffect(refresh, [refresh]);

  const redeem = async () => {
    if (!code.trim()) return;
    const r = await api.redeemCode(code.trim());
    setMsg({ ok: r.ok, message: r.message });
    if (r.ok) {
      setCode('');
      refresh();
    }
  };

  return (
    <>
      <div class="page-head">
        <div class="h2">Conta e correções</div>
        <div class="muted">
          Reconhecimento de item é gratuito e sempre será. O código só libera
          conveniência — nunca o catálogo.
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Estado</div>
          <div class="row">
            <span class="muted">Plano</span>
            <span class={entitlement?.entitlement.tier === 'premium' ? 'badge ok' : 'badge'}>
              {entitlement?.entitlement.tier ?? '—'}
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <label class="field-label" style={{ marginBottom: 6 }}>
              Resgatar código
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                class="input"
                placeholder="código"
                value={code}
                onInput={(e) => setCode((e.target as HTMLInputElement).value)}
              />
              <button class="btn primary" onClick={() => void redeem()}>
                Resgatar
              </button>
            </div>
            {msg ? (
              <div class={`notice ${msg.ok ? '' : 'danger'}`} style={{ marginTop: 10 }}>
                {msg.message}
              </div>
            ) : null}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Fila de correções</div>
          {pending === null ? (
            <div class="muted">carregando…</div>
          ) : pending.length === 0 ? (
            <div class="muted">Nada na fila. Correções que você envia ficam aqui até sincronizar.</div>
          ) : (
            pending.map((r) => (
              <div key={r.itemId + r.field} class="row">
                <span>{r.itemId}</span>
                <span class="badge">{r.field}</span>
              </div>
            ))
          )}
          <div style={{ marginTop: 14 }}>
            <button class="btn" onClick={() => void api.flushPending().then(() => refresh())}>
              Sincronizar agora
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ segurança */

function Safety() {
  return (
    <>
      <div class="page-head">
        <div class="h2">Privacidade e limites</div>
        <div class="muted">O que o app faz com sua tela e o que ele deliberadamente não faz.</div>
      </div>

      <div class="grid" style={{ gap: 12 }}>
        <div class="card">
          <div class="card-title">O que o app faz</div>
          <p class="muted" style={{ lineHeight: 1.7 }}>
            Lê os pixels da janela do jogo por captura de tela do Windows — o mesmo mecanismo que
            a Netflix usa para gravar. Reconhece ícones e texto, e escreve o resultado numa janela
            separada por cima.
          </p>
        </div>

        <div class="card">
          <div class="card-title">O que o app não faz</div>
          <p class="muted" style={{ lineHeight: 1.7 }}>
            Não injeta nada no jogo. Não move o mouse nem digita. Não lê a memória do processo.
            Não tem driver, não hooka, não automatiza. A captura é desligada por padrão e só roda
            com o jogo em primeiro plano.
          </p>
        </div>

        <div class="card">
          <div class="card-title">Risco que é seu</div>
          <p class="muted" style={{ lineHeight: 1.7 }}>
            O ARC Raiders usa quatro camadas de anti-cheat, e nenhuma empresa publica exatamente o
            que elas medem. Um tracker externo é um risco que só você pode avaliar para a sua conta.
            Se estiver em dúvida, pergunte à Embark antes de usar.
          </p>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- ajustes */

function Settings({ config, onChange }: { config: AppConfig; onChange: (p: Partial<AppConfig>) => void }) {
  return (
    <>
      <div class="page-head">
        <div class="h2">Ajustes</div>
        <div class="muted">Captura é opt-in e começa desligada.</div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Captura</div>
          <label class="row">
            <span>
              Ler a tela do jogo
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Desligado por padrão. Precisa estar ligado para o scan funcionar.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.scannerCaptureEnabled}
              onChange={(e) => onChange({ scannerCaptureEnabled: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <div class="field" style={{ marginTop: 16 }}>
            <label class="field-label">Taxa do scan — {config.scannerTargetHz} Hz</label>
            <input
              type="range"
              min={0.5}
              max={30}
              step={0.5}
              value={config.scannerTargetHz}
              onChange={(e) => onChange({ scannerTargetHz: Number((e.target as HTMLInputElement).value) })}
            />
            <div class="muted" style={{ marginTop: 5, fontSize: 11 }}>
              Mais Hz lê mais rápido e gasta mais CPU. Acima de ~10 Hz o ganho é pequeno.
            </div>
          </div>

          <div class="field">
            <label class="field-label">Refresh do HUD — {config.overlayHz} Hz</label>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={config.overlayHz}
              onChange={(e) => onChange({ overlayHz: Number((e.target as HTMLInputElement).value) })}
            />
            <div class="muted" style={{ marginTop: 5, fontSize: 11 }}>
              Só repinta o HUD. Não tem relação com a leitura da tela.
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Apresentação e dado</div>

          <div class="field">
            <label class="field-label">Idioma</label>
            <select
              class="input"
              value={config.locale}
              onChange={(e) => onChange({ locale: (e.target as HTMLSelectElement).value })}
            >
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en">English</option>
            </select>
            <div class="muted" style={{ marginTop: 5, fontSize: 11 }}>
              Muda eventos, mapas, grupos e subcategorias do mapa. Os nomes de item
              vêm do jogo e seguem o idioma dele.
            </div>
          </div>

          <label class="row">
            <span>
              Overlay
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Camada de leitura sobre o jogo.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.overlayVisible}
              onChange={(e) => onChange({ overlayVisible: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <label class="row">
            <span>
              Badges nos slots
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Tier e valor dentro de cada célula do inventário.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.badgesEnabled}
              onChange={(e) => onChange({ badgesEnabled: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <div class="field">
            <label class="field-label">Opacidade do badge — {Math.round(config.badgeOpacity * 100)}%</label>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.05}
              value={config.badgeOpacity}
              onChange={(e) => onChange({ badgeOpacity: Number((e.target as HTMLInputElement).value) })}
            />
          </div>

          <label class="row">
            <span>
              Mostrar preços
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Valor unitário, somado na barra de HUD.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.showPrices}
              onChange={(e) => onChange({ showPrices: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <label class="row">
            <span>
              Card do item
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Abre a ficha ao passar o mouse. Só mostra o que existe no catálogo.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.itemCardEnabled}
              onChange={(e) => onChange({ itemCardEnabled: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <label class="row">
            <span>
              Avisos
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Alertas de item desconhecido e estado do motor.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.noticesEnabled}
              onChange={(e) => onChange({ noticesEnabled: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <div class="field">
            <label class="field-label">Minimizar na bandeja</label>
            <label class="row">
              <span>
                Manter o app rodando sem janela
                <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                  Desligado, fechar a janela encerra o app.
                </span>
              </span>
              <input
                type="checkbox"
                checked={config.minimizeToTray}
                onChange={(e) => onChange({ minimizeToTray: (e.target as HTMLInputElement).checked })}
              />
            </label>
          </div>

          <div class="field">
            <label class="field-label">Atalhos</label>
            {(
              [
                ['panelHotkey', 'Abrir painel'],
                ['overlayHotkey', 'Alternar overlay'],
                ['identifyHotkey', 'Identificar item'],
              ] as const
            ).map(([k, rotulo]) => (
              <div key={k} class="row" style={{ marginBottom: 6 }}>
                <span style={{ minWidth: 150 }}>{rotulo}</span>
                <input
                  class="input"
                  style={{ maxWidth: 190 }}
                  value={config[k]}
                  onChange={(e) => onChange({ [k]: (e.target as HTMLInputElement).value })}
                />
              </div>
            ))}
            <div class="muted" style={{ marginTop: 5, fontSize: 11 }}>
              Formato <code>Alt+Shift+Q</code>. A tecla <code>Identificar item</code> só
              funciona com o jogo em foco.
            </div>
          </div>

          <label class="row">
            <span>
              OCR
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Ler texto na tela. Gera aviso quando o motor não está instalado.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.ocrEnabled}
              onChange={(e) => onChange({ ocrEnabled: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <div class="field">
            <label class="field-label">Feed de atualização</label>
            <input
              class="input"
              placeholder="https://github.com/SEU-USUARIO/arcgx/releases/latest/download"
              value={config.updateFeedUrl}
              onChange={(e) => onChange({ updateFeedUrl: (e.target as HTMLInputElement).value })}
            />
            <div class="muted" style={{ marginTop: 5, fontSize: 11 }}>
              Vazio = usa o <code>app-update.yml</code> que veio no instalador. Preencha
              apenas para apontar outro repositório, sem reinstalar. Só <code>https</code>.
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-3" style={{ marginTop: 12 }}>
        <div class="card">
          <div class="card-title">Diagnóstico</div>
          <button class="btn" onClick={() => void api.openLogsFolder()}>
            Abrir pasta de logs
          </button>
        </div>
        <div class="card">
          <div class="card-title">Dados</div>
          <button class="btn" onClick={() => void api.syncData()}>
            Sincronizar base
          </button>
        </div>
        <div class="card">
          <div class="card-title">Atualização</div>
          <button class="btn" onClick={() => void api.checkUpdate()}>
            Verificar agora
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- shell */

type View =
  | 'painel'
  | 'necessidades'
  | 'quests'
  | 'projetos'
  | 'pesquisa'
  | 'stash'
  | 'incursoes'
  | 'mapa'
  | 'eventos'
  | 'itens'
  | 'hud'
  | 'ajustes'
  | 'conta'
  | 'privacidade'
  | 'creditos';

const VIEWS: View[] = [
  'painel',
  'necessidades',
  'quests',
  'projetos',
  'pesquisa',
  'stash',
  'incursoes',
  'mapa',
  'eventos',
  'itens',
  'hud',
  'ajustes',
  'conta',
  'privacidade',
  'creditos',
];

const TITLES: Record<View, { t: string; s: string }> = {
  painel: { t: 'Painel', s: 'estado da leitura e da base' },
  necessidades: { t: 'Necessidades', s: 'o que quests e projetos ainda pedem' },
  quests: { t: 'Quests', s: 'entregas, comerciantes e recompensas' },
  projetos: { t: 'Projetos', s: 'fases do outpost' },
  pesquisa: { t: 'Pesquisa', s: 'árvore da estação' },
  stash: { t: 'Stash', s: 'o que você carrega' },
  incursoes: { t: 'Incursões', s: 'histórico e valor de saque' },
  mapa: { t: 'Mapas', s: 'onde as coisas estão' },
  eventos: { t: 'Eventos', s: 'agenda de mapa' },
  itens: { t: 'Itens', s: 'catálogo, arte e valores de referência' },
  hud: { t: 'HUD', s: 'o que aparece sobre o jogo' },
  ajustes: { t: 'Ajustes', s: 'idioma e diagnóstico' },
  conta: { t: 'Conta', s: 'códigos e fila de correções' },
  privacidade: { t: 'Privacidade', s: 'o que o app faz e não faz' },
  creditos: { t: 'Créditos', s: 'origem dos dados' },
};

/** Grupos do menu, na mesma ordem de leitura da referência. */
const MENU: { grupo: string; itens: { id: View; label: string }[] }[] = [
  {
    grupo: 'Progresso',
    itens: [
      { id: 'painel', label: 'Painel' },
      { id: 'necessidades', label: 'Necessidades' },
      { id: 'quests', label: 'Quests' },
      { id: 'projetos', label: 'Projetos' },
      { id: 'pesquisa', label: 'Pesquisa' },
    ],
  },
  {
    grupo: 'Coleção',
    itens: [
      { id: 'stash', label: 'Stash' },
      { id: 'incursoes', label: 'Incursões' },
      { id: 'itens', label: 'Itens' },
    ],
  },
  {
    grupo: 'Mundo',
    itens: [
      { id: 'mapa', label: 'Mapas' },
      { id: 'eventos', label: 'Eventos' },
    ],
  },
  {
    grupo: 'App',
    itens: [
      { id: 'hud', label: 'HUD' },
      { id: 'ajustes', label: 'Ajustes' },
      { id: 'conta', label: 'Conta' },
      { id: 'privacidade', label: 'Privacidade' },
      { id: 'creditos', label: 'Créditos' },
    ],
  },
];

function initialView(): View {
  const v = new URLSearchParams(location.search).get('view');
  return VIEWS.includes(v as View) ? (v as View) : 'painel';
}

export function App() {
  const [view, setView] = useState<View>(initialView);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    void api.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  /**
   * ## ## ## O idioma precisa existir fora do React
   *
   * `txt()` é chamada dentro de `useMemo` e de `Array.sort`, que não enxergam
   * o estado do componente. Se o idioma vivesse só num `useState`, a busca e a
   * ordenação continuariam em pt-BR mesmo com a tela em inglês.
   *
   * Por isso `setIdioma` escreve numa variável de módulo, e esta função é o
   * ponto único onde o estado do React é replicado para lá.
   */
  useEffect(() => {
    setIdioma(config?.locale);
  }, [config?.locale]);

  const go = (v: View) => {
    setView(v);
    const url = new URL(location.href);
    url.searchParams.set('view', v);
    history.replaceState(null, '', url);
  };

  const patch = (p: Partial<AppConfig>) => {
    void api.setConfig(p).then(setConfig).catch(() => setConfig(null));
  };

  const meta = TITLES[view];

  return (
    <div class="app">
      <div class="brand">
        <img class="brand-mark" src="./logo-192.png" alt="" width={26} height={26} draggable={false} />
        <div class="brand-name">Arc GX</div>
      </div>

      <div class="head">
        <h1>{meta.t}</h1>
        <span class="head-sub">{meta.s}</span>
      </div>

      <nav class="nav">
        {MENU.map((g) => (
          <div key={g.grupo}>
            <div class="nav-group">{g.grupo}</div>
            {g.itens.map((it) => (
              <NavItem
                key={it.id}
                label={it.label}
                active={view === it.id}
                onClick={() => go(it.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      <main class="main">
      <ErrorBoundary nome={meta.t}>
        {view === 'painel' ? (
          <>
            <GameUpdateNotice />
            <Dashboard />
          </>
        ) : view === 'necessidades' ? (
          <Needs />
        ) : view === 'quests' ? (
          <Quests />
        ) : view === 'projetos' ? (
          <Projects />
        ) : view === 'pesquisa' ? (
          <Research />
        ) : view === 'stash' ? (
          <Stash />
        ) : view === 'incursoes' ? (
          <Raids />
        ) : view === 'mapa' ? (
          <MapsPage />
        ) : view === 'eventos' ? (
          <EventsLive />
        ) : view === 'itens' ? (
          <Items />
        ) : view === 'hud' ? (
          config ? (
            <OverlayPage config={config} onChange={patch} />
          ) : (
            <div class="muted">carregando…</div>
          )
        ) : view === 'ajustes' ? (
          config ? (
            <Settings config={config} onChange={patch} />
          ) : (
            <div class="muted">carregando ajustes…</div>
          )
        ) : view === 'conta' ? (
          <Account />
        ) : view === 'privacidade' ? (
          <Safety />
        ) : (
          <Credits />
        )}
      </ErrorBoundary>
      </main>
    </div>
  );
}

function NavItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button class="nav-item" aria-current={active ? 'page' : undefined} onClick={onClick}>
      {label}
    </button>
  );
}

render(<App />, document.getElementById('root')!);
