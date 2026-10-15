/**
 * Serviço de checagem de atualização do jogo.
 *
 * Roda no main porque precisa de rede e de timer, e porque o resultado é um
 * estado que o painel consulta — não uma chamada que o renderer dispara a cada
 * vez que abre a aba.
 *
 * Regra central: **nunca atualiza sozinho**. Ele detecta a diferença, guarda
 * um resumo e deixa o usuário decidir. Conteúdo novo não revisado costuma vir
 * com metade dos ícones, e classificador de ícone com galeria pela meia erra
 * mais do que classificador desatualizado.
 */

import { catalogoRemoto, comparar, descrever, type UpdateCheck } from '@arcgx/shared';

import { createLogger } from '@arcgx/shared';

const log = createLogger('game-update');

/** A cada 6 h é suficiente: patch do jogo não sai a cada minuto. */
const INTERVALO_MS = 6 * 60 * 60 * 1000;

export class GameUpdateService {
  private timer: NodeJS.Timeout | null = null;
  private atual: UpdateCheck | null = null;
  private verificando = false;
  private decididos = new Set<string>();

  constructor(
    private readonly catalogoLocal: () => Record<string, unknown> | null,
    private readonly aoMudar: (c: UpdateCheck | null) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    // primeira checagem só depois do app assentar: no boot a rede e o disco
    // ainda estão ocupados e a checagem não é urgente
    this.timer = setTimeout(() => {
      void this.checar();
      this.timer = setInterval(() => void this.checar(), INTERVALO_MS);
      // não segura o processo vivo por causa disso
      this.timer.unref?.();
    }, 60_000);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async checar(): Promise<UpdateCheck | null> {
    if (this.verificando) return this.atual;
    this.verificando = true;
    try {
      const local = this.catalogoLocal();
      if (!local || Object.keys(local).length === 0) {
        log.info('catalogo local vazio — checagem adiada');
        return this.atual;
      }

      const remoto = await catalogoRemoto();
      const r = comparar(local, remoto);
      const check: UpdateCheck = { ...r, checkedAt: Date.now() };

      // só avisa de novidade que ainda não foi respondida
      if (check.hasUpdate) {
        log.info(descrever(check));
      }
      this.atual = check;
      this.aoMudar(check);
      return check;
    } catch (err) {
      log.warn('checagem falhou', err instanceof Error ? err.message : String(err));
      return this.atual;
    } finally {
      this.verificando = false;
    }
  }

  get(): UpdateCheck | null {
    return this.atual;
  }

  /** O usuário aceitou ou recusou; some da fila de avisos. */
  resolver(chave: string): void {
    this.decididos.add(chave);
  }

  jaDecidido(chave: string): boolean {
    return this.decididos.has(chave);
  }
}
