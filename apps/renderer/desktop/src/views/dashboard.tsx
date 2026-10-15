import { useEffect, useState } from 'preact/hooks';

import type { AppStatus, GameWindow } from '@arcgx/shared';

const api = window.arcgx.desktop;

/**
 * Por que a janela não serve para a grade.
 *
 * A grade 4x5 do inventário foi medida em 1920x1080. Numa janela menor o
 * detector devolve uma grade que não corresponde a nenhuma célula real — o
 * scan sai vazio sem erro nenhum. Dizer isso na lista é melhor do que deixar
 * o usuário descobrir depois.
 */
function captureHint(w: GameWindow): string | null {
  const r = w.rect;
  if (!r) return 'janela sem retângulo — não dá para capturar';
  if (r.width < 1280 || r.height < 720) {
    return `janela pequena (${r.width}x${r.height}) — a grade foi medida em 1920x1080`;
  }
  return null;
}

/** Formata um contador grande sem poluir o painel com zeros. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * ## ## ## Por que o `type` cru não serve
 *
 * O painel mostrava literalmente `disabled` na linha "Atualização", e o
 * usuário leu como "o autoupdate está quebrado". Não estava: o `Updater`
 * respondia `disabled` com `reason: 'atualizado'` **depois** de consultar o
 * GitHub e encontrar a mesma versão — ou seja, era sucesso.
 *
 * O mesmo `disabled` também aparece quando o motor nem carregou. Um rótulo
 * só para os dois casos obrigaria o usuário a abrir o log para saber qual.
 *
 * A distinção que importa é `reason`: ela separa "não há o que atualizar" de
 * "não consegui verificar".
 */
function rotuloUpdate(u: AppStatus['update'] | undefined): string {
  if (!u) return '—';
  switch (u.type) {
    case 'checking':
      return 'verificando…';
    case 'available':
      return `nova versão ${u.version ?? ''}`.trim();
    case 'downloading':
      return `baixando ${Math.round(u.percent ?? 0)}%`;
    case 'downloaded':
      return `pronto para instalar (${u.version ?? '?'})`;
    case 'error':
      return `falhou: ${u.message ?? 'sem detalhe'}`;
    case 'disabled':
      // O `reason` é o que separa "você já está na última" de "não
      // consegui checar" — sem ele, os dois viravam a mesma palavra.
      return u.reason === 'atualizado' ? 'você está na última versão' : (u.reason ?? 'desligado');
    default:
      return String((u as { type: string }).type);
  }
}

function captureState(status: AppStatus | null): {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
  detail: string;
} {
  if (!status) return { label: 'desconhecido', tone: 'warn', detail: '—' };
  if (!status.capture.available) {
    return {
      label: 'indisponível',
      tone: 'danger',
      detail: status.capture.error ?? 'addon wgc-capture não carregou',
    };
  }
  if (!status.capture.running) {
    return { label: 'parada', tone: 'warn', detail: 'opt-in — iniciar abaixo, com o jogo em foco' };
  }
  return {
    label: 'capturando',
    tone: 'ok',
    detail: status.capture.windowTitle ?? 'janela do jogo',
  };
}

/**
 * Controle de captura.
 *
 * ## Por que este componente existe
 *
 * O `CaptureManager` já sabia `startWindow(hwnd)` e já tinha `listWindows()` e
 * até um `findGameWindow('arc raiders')` — nada disso era chamado de lugar
 * nenhum. Não havia handler de IPC, não havia preload, não havia botão. O
 * painel dizia "captura é opt-in, começa nas Ajustes" e as Ajustes não tinham
 * como começar. O caminho inteiro estava faltando, e o sintoma era o app
 * parecer mudo.
 */
function CaptureControl({ status }: { status: AppStatus | null }) {
  const [janelas, setJanelas] = useState<GameWindow[] | null>(null);
  const [escolha, setEscolha] = useState<number | ''>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregando = status?.capture.running ?? false;

  const listar = () => {
    setOcupado(true);
    void api
      .listGameWindows()
      .then((w) => {
        setJanelas(w);
        setEscolha('');
        if (!w.length) setMsg('nenhuma janela visível encontrada');
        else setMsg(null);
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setOcupado(false));
  };

  const iniciar = () => {
    setOcupado(true);
    setMsg(null);
    void api
      .startCapture(escolha === '' ? undefined : escolha)
      .then((r) => {
        if (r.ok) setMsg(`capturando: ${r.title ?? 'janela do jogo'}`);
        else setMsg(r.error ?? 'recusado — o jogo precisa estar em primeiro plano');
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setOcupado(false));
  };

  const parar = () => {
    void api.stopCapture().then(() => setMsg('captura parada'));
  };

  if (carregando) {
    return (
      <div class="card">
        <div class="card-title">Captura da tela</div>
        <div class="muted">
          Sessão armada em <strong>{status?.capture.windowTitle ?? 'janela do jogo'}</strong>.
        </div>
        <div class="muted" style={{ marginTop: 6, fontSize: 12 }}>
          O scan só corre com o jogo em primeiro plano — alt-tab para o jogo e ele começa sozinho.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button class="btn" onClick={parar} disabled={ocupado}>
            Parar captura
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-title">Captura da tela</div>
      <div class="muted" style={{ marginBottom: 10 }}>
        A leitura é opt-in e só compõe a janela do jogo enquanto ela estiver em primeiro plano.
        Nada é gravado sem você pedir.
      </div>

      {janelas === null ? (
        <button class="btn btn-primary" onClick={listar} disabled={ocupado}>
          Procurar janela do jogo
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              class="input"
              style={{ flex: 1 }}
              value={String(escolha)}
              onChange={(e) => setEscolha(Number((e.target as HTMLSelectElement).value) || '')}
            >
              <option value="">Detectar automaticamente</option>
              {janelas.map((w) => (
                <option key={w.hwnd} value={String(w.hwnd)}>
                  {w.cleanTitle || `(sem título) — ${w.rect?.width ?? '?'}x${w.rect?.height ?? '?'}`}
                </option>
              ))}
            </select>
            <button class="btn btn-primary" onClick={iniciar} disabled={ocupado}>
              Iniciar
            </button>
            <button class="btn" onClick={listar} disabled={ocupado}>
              Atualizar
            </button>
          </div>

          {escolha !== '' && janelas.length > 0 && (
            <div class="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {(() => {
                const w = janelas.find((j) => j.hwnd === escolha);
                const hint = w ? captureHint(w) : null;
                return hint
                  ? `⚠ ${hint}`
                  : `janela ${w?.rect?.width}x${w?.rect?.height} — ok para a grade 4x5`;
              })()}
            </div>
          )}

          {msg && (
            <div
              class="muted"
              style={{ marginTop: 8, fontSize: 12, color: msg.startsWith('capturando') ? 'var(--ok)' : 'var(--warn)' }}
            >
              {msg}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Dashboard() {
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    void api.getStatus().then(setStatus);
    const off = api.onStatusChanged(setStatus);
    const poll = window.setInterval(() => void api.getStatus().then(setStatus), 1500);
    return () => {
      off();
      window.clearInterval(poll);
    };
  }, []);

  const cap = captureState(status);
  const data = status?.dataRelease;

  return (
    <>
      <div class="page-head">
        <div class="h2">Painel</div>
        <div class="muted">Estado da leitura, da base de dados e do classificador.</div>
      </div>

      <div class="grid grid-4" style={{ marginBottom: 12 }}>
        <div class="stat">
          <div class="stat-label">Captura</div>
          <div class={`stat-value ${cap.tone}`} style={{ fontSize: 15, paddingTop: 6 }}>
            {cap.label}
          </div>
          <div class="stat-sub" title={cap.detail}>
            {cap.detail.length > 38 ? `${cap.detail.slice(0, 38)}…` : cap.detail}
          </div>
        </div>

        <div class="stat">
          <div class="stat-label">Base de dados</div>
          <div
            class={`stat-value ${data?.state === 'ready' ? 'ok' : 'warn'}`}
            style={{ fontSize: 15, paddingTop: 6 }}
          >
            {data?.state === 'ready' ? 'pronta' : data?.state ?? '—'}
          </div>
          <div class="stat-sub">
            {data?.count ? `${compact(data.count)} itens` : (data?.error ?? 'ainda não carregada')}
          </div>
        </div>

        <div class="stat">
          <div class="stat-label">Taxa do scan</div>
          <div class="stat-value">
            {status?.fps.scan ? status.fps.scan.toFixed(0) : '—'}
            <span style={{ fontSize: 12, color: 'var(--gx-text-3)', marginLeft: 3 }}>Hz</span>
          </div>
          <div class="stat-sub">
            {status?.fps.overlay ? `overlay a ${status.fps.overlay.toFixed(0)} Hz` : 'overlay parado'}
          </div>
        </div>

        <div class="stat">
          <div class="stat-label">Memória</div>
          <div class="stat-value">{status?.memoryMb ?? '—'}</div>
          <div class="stat-sub">MB no processo principal</div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Cadeia de leitura</div>          <Chain
            ok={Boolean(status?.capture.available)}
            label="Addon de captura"
            detail={status?.capture.available ? 'wgc-capture carregado' : 'falhou ao carregar'}
          />
          <Chain
            ok={cap.label === 'capturando'}
            label="Sessão WGC"
            detail={cap.label === 'capturando' ? 'streaming ativo' : 'sem sessão'}
          />
          <Chain
            ok={data?.state === 'ready'}
            label="Base local"
            detail={data?.state === 'ready' ? `${compact(data.count ?? 0)} itens indexados` : 'pendente'}
          />
          <Chain
            ok={Boolean(status?.vision.available)}
            label="Visão computacional"
            detail={status?.vision.available ? 'cell-vision pronto' : 'cell-vision indisponível'}
          />
          <Chain
            ok={Boolean(status?.ocr.available)}
            label="OCR"
            detail={status?.ocr.available ? (status.ocr.engine ?? 'disponível') : 'não habilitado'}
          />
        </div>

        <div class="card">
          <div class="card-title">Ambiente</div>
          <Row k="Versão" v={status?.version ?? '—'} />
          <Row k="Electron" v={status?.electron ?? '—'} mono />
          <Row k="Node" v={status?.node ?? '—'} mono />
          <Row k="Plataforma" v={status?.platform ?? '—'} mono />
          <Row k="Fonte dos pixels" v={status?.capture.source ?? 'janela'} />
          <Row k="Atualização" v={rotuloUpdate(status?.update)} />
        </div>
      </div>

      <div class="grid grid-2" style={{ marginTop: 12 }}>
        <CaptureControl status={status} />
        <div />
      </div>

      {data?.error ? (
        <div class="notice danger" style={{ marginTop: 12 }}>
          <div>
            <strong>Base de dados com erro.</strong> {data.error}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Chain({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div class="row">
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span class={`dot`} style={{ color: ok ? 'var(--gx-ok)' : 'var(--gx-text-3)' }} />
        <span style={{ color: ok ? 'var(--gx-text-1)' : 'var(--gx-text-3)' }}>{label}</span>
      </span>
      <span class="muted" style={{ fontSize: 11 }}>
        {detail}
      </span>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div class="row">
      <span class="muted">{k}</span>
      <span class={mono ? 'mono' : ''} style={{ fontSize: 12 }}>
        {v}
      </span>
    </div>
  );
}
