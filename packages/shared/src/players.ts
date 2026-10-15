/**
 * Contagem de jogadores online.
 *
 * Tipo no shared porque o main coleta e o renderer exibe — os dois precisam
 * da mesma forma, e duplicar o contrato é como o `appConfig` e o
 * `scannerCaptureEnabled` já divergiram uma vez.
 */
export interface PlayerCount {
  appid: string;
  /** jogadores no momento da leitura */
  online: number;
  /** quando o main leu (epoch ms) */
  fetchedAt: number;
  ok: boolean;
  erro?: string;
}
