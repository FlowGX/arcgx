import type { AppConfig } from '@arcgx/shared';

/**
 * Controle do HUD sobre o jogo.
 *
 * Fica em arquivo próprio porque não é uma aba de dado: não lê `game/*.json`,
 * só mexe em `AppConfig`. Ficar em `views/game.tsx` junto com Stash e Incursões
 * só confundia — e foi o que fez a limpeza de código morto cortar ele junto.
 */
export function OverlayPage({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (p: Partial<AppConfig>) => void;
}) {
  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">HUD sobre o jogo</div>
          <div class="muted">O que aparece em cima da janela do jogo</div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Controle</div>
          <label class="row">
            <span>
              Ligar a leitura da tela
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Só roda com o jogo em primeiro plano. Desligado por padrão.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.scannerCaptureEnabled}
              onChange={(e) =>
                onChange({ scannerCaptureEnabled: (e.target as HTMLInputElement).checked })
              }
            />
          </label>

          <label class="row" style={{ marginTop: 12 }}>
            <span>
              Reconhecer texto (OCR)
              <span class="muted" style={{ display: 'block', marginTop: 2 }}>
                Lê o nome do item no jogo para confirmar o que o ícone já disse.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.ocrEnabled}
              onChange={(e) => onChange({ ocrEnabled: (e.target as HTMLInputElement).checked })}
            />
          </label>

          <div class="field" style={{ marginTop: 18 }}>
            <label class="field-label">Taxa do scan — {config.scannerTargetHz} Hz</label>
            <input
              type="range"
              min={0.5}
              max={30}
              step={0.5}
              value={config.scannerTargetHz}
              onChange={(e) =>
                onChange({ scannerTargetHz: Number((e.target as HTMLInputElement).value) })
              }
            />
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
          </div>
        </div>

        <div class="card">
          <div class="card-title">Prévia</div>
          <div class="preview">
            <div class="pv-slot">
              <span class="pv-outline" />
              <span class="pv-tag">3/8</span>
            </div>
            <div class="pv-slot">
              <span class="pv-outline ok" />
              <span class="pv-tag ok">✓ 20/8</span>
            </div>
            <div class="pv-slot">
              <span class="pv-outline warn" />
              <span class="pv-tag warn">?</span>
            </div>
          </div>
          <div class="muted" style={{ marginTop: 12, fontSize: 11, lineHeight: 1.6 }}>
            Moldura colorida por estado — vermelho precisa, verde resolvido, âmbar não identificado — e
            a etiqueta com a contagem, como no HUD da referência.
          </div>
        </div>
      </div>
    </>
  );
}
