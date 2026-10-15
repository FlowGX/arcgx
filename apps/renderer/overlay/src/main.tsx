import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type { AppConfig, ItemDetection, ScanResult, SubmitResult, UnknownSignal } from '@arcgx/shared';
import '@arcgx/design/tokens.css';
import '@arcgx/design/components.css';
import './overlay.css';

const api = window.arcgx.overlay;

/**
 * Contadores dos contêineres e total da raid.
 *
 * ## ## ## Por que "ainda não leu" e diferente de "zero"
 *
 * O OCR roda a 2 Hz e o scan a 30. Num quadro sem leitura, o certo e não
 * desenhar nada — mostrar `0/0` num slot com item é pior que não mostrar,
 * porque o usuário para de acreditar no número. O main preserva a última
 * leitura válida justamente para não piscar; aqui o que não existe é o
 * primeiro quadro, e ele fica vazio.
 */
function HudBar({ hud }: { hud: ScanResult['hud'] | null | undefined }) {
  if (!hud) return null;
  if (hud.indisponivel) {
    return <div class="gx-hud gx-hud--vazio">leitura indisponível</div>;
  }

  const ordem = ['mochila', 'uso-rapido', 'bolso-seguro'];
  const rotulos: Record<string, string> = {
    mochila: 'MOCHILA',
    'uso-rapido': 'USO',
    'bolso-seguro': 'SEGURO',
  };

  const linhas = ordem
    .filter((id) => hud.contadores[id])
    .map((id) => {
      const c = hud.contadores[id]!;
      return (
        <span key={id} class="gx-hud__linha">
          <span class="gx-hud__nome">{rotulos[id] ?? id}</span>
          <span class="gx-hud__num">
            {c.ocupado}/{c.capacidade}
          </span>
        </span>
      );
    });

  if (!linhas.length && hud.total === null) return null;

  return (
    <div class="gx-hud">
      {linhas}
      {hud.total !== null ? (
        <span class="gx-hud__total" title="total do jogo, inclui acessórios">
          {hud.total.toLocaleString('pt-BR')}
        </span>
      ) : null}
    </div>
  );
}

function Badge({ det, config }: { det: ItemDetection; config: AppConfig }) {
  const style: Record<string, string> = {
    left: `${det.cell.rect.x}px`,
    top: `${det.cell.rect.y}px`,
    width: `${det.cell.rect.width}px`,
    height: `${det.cell.rect.height}px`,
    opacity: String(config.badgeOpacity),
  };

  /**
   * Variante de nível: `item.id` é `torrente-iv` mas a arte é idêntica à de
   * `torrente-iii`, e quem decide é o numeral — que a moldura mascara. Mostrar
   * o preço do IV aqui é afirmar um nível que ninguém mediu. A família é o que
   * o encoder realmente sabe.
   */
  const soFamilia = det.levelVariant && !!det.familia;

  return (
    <div class="gx-badge" style={style}>
      <span class={`gx-chip gx-chip--${det.item.tier}`}>{det.item.tier}</span>
      {config.showPrices && det.item.baseValue && !soFamilia ? (
        <span class="gx-badge__value">{det.item.baseValue.toLocaleString('pt-BR')}</span>
      ) : null}
      {soFamilia ? <span class="gx-badge__level">nível?</span> : null}
    </div>
  );
}

/**
 * Prompt de item desconhecido.
 *
 * É a peça que conserta o dado: o classificador não achou o ícone, o usuário
 * dá o nome em um toque, e isso vira correção para a base da comunidade.
 * Deliberadamente minimalista — aparece por cima do jogo e some rápido.
 */
function UnknownPrompt({
  signal,
  onDone,
  onDismiss,
}: {
  signal: UnknownSignal;
  onDone: (name: string) => Promise<SubmitResult>;
  onDismiss: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.setInteractive(true);
    input.current?.focus();
    return () => void api.setInteractive(false);
  }, []);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await onDone(trimmed);
    setBusy(false);
    if (res.ok) onDismiss();
  }, [name, busy, onDone, onDismiss]);

  return (
    <div class="gx-unknown">
      <div class="gx-unknown__box">
        <span class="gx-unknown__badge">não reconheci este item</span>
        <input
          ref={input}
          class="gx-input"
          value={name}
          maxLength={80}
          placeholder="qual é o nome?"
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') onDismiss();
          }}
        />
        <div class="gx-unknown__actions">
          <button class="gx-btn" disabled={busy} onClick={onDismiss}>
            ignorar
          </button>
          <button class="gx-btn gx-btn--primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? 'enviando…' : 'confirmar'}
          </button>
        </div>
        <p class="gx-unknown__hint">a base é atualizada com o que a galera confirmar</p>
      </div>
    </div>
  );
}

export function Overlay() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ signal: UnknownSignal; det: ItemDetection } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  /** ultimo resultado, para abrir o prompt sobre o que esta na tela agora */
  const resultRef = useRef<ScanResult | null>(null);

  useEffect(() => {
    api.ready();
    const offCfg = api.onConfig(setConfig);
    const offResult = api.onScanResult((r) => {
      /**
       * O prompt de "não reconheci" **nao** abre mais sozinho.
       *
       * Ele precisa de foco de teclado para o input, e o scan roda a 30 Hz
       * enquanto o jogador esta no meio da raid: abrir um modal por nota
       * baixa tirava o foco do jogo e o teclado junto. Perder o controle da
       * personagem por causa de um item que o classificador nao fechou e um
       * preco absurdo por um recurso de rotulagem.
       *
       * Agora o gatilho e o atalho `identifyHotkey`, de fora do overlay — que
       * e click-through e por isso nao recebe teclado.
       */
      // `visivel === false` e o jogo fora de foco: limpa em vez de guardar.
      // Guardar manteria as badges congeladas sobre o desktop.
      resultRef.current = r.visivel === false ? null : r;
      setResult(r.visivel === false ? null : r);
    });
    const offIdentify = api.onIdentify(() => {
      /**
       * Abre sobre a deteccao de menor confianca — a que o jogador nao
       * conseguiria ler sozinho. Sem deteccao nenhuma nao ha o que perguntar,
       * e um prompt vazio seria pior que nenhum.
       */
      const dets = resultRef.current?.detections ?? [];
      if (!dets.length) return;
      const alvo = dets.reduce((a, b) => (b.confidence < a.confidence ? b : a));
      setPending({
        signal: {
          iconHash: alvo.galleryHit ?? alvo.item.id,
          slotIndex: alvo.cell.index,
          cellSize: Math.round(alvo.cell.rect.width),
          seen: 1,
          observedAt: new Date().toISOString(),
        },
        det: alvo,
      });
    });
    const offNotice = api.onNotice((n) => {
      setNotice(n.message);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 3000);
    });
    return () => {
      offCfg();
      offResult();
      offIdentify();
      offNotice();
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setPending(null);
    void api.clear();
  }, []);

  const submitName = useCallback(
    async (name: string) => {
      if (!pending) return { ok: false, status: 'pending' as const, message: 'sem item' };
      const res = await api.nameUnknown(pending.signal, name);
      setNotice(res.message);
      return res;
    },
    [pending],
  );

  const dismiss = useCallback(() => {
    setPending(null);
    void api.cancelUnknown();
  }, []);

  return (
    <div class="gx-overlay">
      {config?.badgesEnabled && result
        ? result.detections
            .filter((d) => d !== pending?.det)
            .map((det) => <Badge key={det.cell.index} det={det} config={config} />)
        : null}

      {config?.badgesEnabled ? <HudBar hud={result?.hud} /> : null}

      {notice ? <div class="gx-overlay__notice">{notice}</div> : null}

      {result && !result.detections.length && !pending ? (
        <div class="gx-overlay__hint">Arc GX · {result.ms.toFixed(0)} ms</div>
      ) : null}

      {pending ? <UnknownPrompt signal={pending.signal} onDone={submitName} onDismiss={dismiss} /> : null}

      <button class="gx-overlay__reset" onClick={clear} title="limpar">
        ×
      </button>
    </div>
  );
}

render(<Overlay />, document.getElementById('root')!);