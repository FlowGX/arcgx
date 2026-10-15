import { Component } from 'preact';
import type { ComponentChildren } from 'preact';

/**
 * Barreira de erro por view.
 *
 * Sem isto, uma exceção dentro de uma aba derruba a árvore inteira do Preact:
 * a janela fica aberta, o menu continua clicável e o conteúdo some. Foi
 * exatamente o que aconteceu com `{slug}` no Leaflet — o painel inteiro ficou
 * em branco e parecia que o build tinha voltado ao anterior.
 *
 * Uma aba quebrada tem que mostrar que ela quebrou, com o motivo, e deixar as
 * outras continuarem funcionando.
 */
interface Props {
  /** identificador da view, mostrado no aviso */
  nome: string;
  children: ComponentChildren;
}

interface State {
  erro: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { erro: null, info: '' };

  static override getDerivedStateFromError(erro: Error): Partial<State> {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: unknown): void {
    const i = info as { componentStack?: string } | undefined;
    this.setState({ erro, info: i?.componentStack ?? '' });
    console.error(`[view:${this.props.nome}]`, erro, i?.componentStack ?? '');
  }

  override render() {
    const { erro, info } = this.state;
    if (!erro) return this.props.children;

    const linha = info.split('\n').find((l) => l.trim().startsWith('at '))?.trim();

    return (
      <div class="card" style={{ borderColor: 'var(--gx-danger)' }}>
        <div class="empty">
          <div class="empty-title">A aba “{this.props.nome}” quebrou</div>
          <div class="empty-hint">
            As outras abas continuam funcionando. O erro foi registrado no log.
          </div>
          <div class="mono" style={{ marginTop: 12, fontSize: 11, color: 'var(--gx-danger)' }}>
            {erro.message}
          </div>
          {linha ? (
            <div class="mono muted" style={{ marginTop: 5, fontSize: 10.5 }}>
              {linha}
            </div>
          ) : null}
          <button
            type="button"
            class="btn"
            style={{ marginTop: 14 }}
            onClick={() => this.setState({ erro: null, info: '' })}
          >
            tentar de novo
          </button>
        </div>
      </div>
    );
  }
}
