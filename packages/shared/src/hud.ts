import type { Rect } from './types.js';

/**
 * Onde os numeros da HUD do jogo ficam na tela.
 *
 * ## ## ## Por que deslocamento, e nao coordenada absoluta
 *
 * A posicao do contador `x/y` e relativa ao **painel** que ele conta: o da
 * mochila comeca 97 px a direita da origem da mochila. Guardar a coordenada
 * absolutaamarra o OCR a um painel especifico e obriga a duplicar o numero
 * quando outro contêiner precisar do mesmo campo.
 *
 * ## ## ## Por que isto nao estava no `panels.ts`
 *
 * `panels.ts` e a grade de **itens** — os cards. Isto e a grade de **texto**:
 * contador de cada contêiner e o total da raid. Sao grades diferentes, com
 *origens diferentes, e misturar as duas num arquivo so ja causou um bug em
 * que meio dia.
 *
 * ## ## ## De onde veio cada medida
 *
 * Todas em 1920x1080, conferidas visualmente nos quadros salvos e — o que
 * segurou a medida — cruzadas com o que o proprio jogo escreve:
 *
 *   mochila x/y      x 1140 y 226   leu "4/20", "10/22", "0/10", "6/22"
 *   uso-rapido x/y   x 1600 y 226   leu "5/5", "4/4", "0/4"
 *   bolso-seguro x/y x 1570 y 658   leu "0/3", "2/2", "1/1"
 *   total da raid    x  880 y 166   leu "43.679", "34.102", "2.000", "29.484"
 *
 * O `x` do bolso-seguro e 1570 e nao 1600: comecando em 1600 o motor le um
 * caractere **antes** do numero e devolve "00/3" para "0/3" — medido em
 * `tools/afinar-bolso.mjs`.
 */
export type PapelRegiao = 'contador' | 'valorTotal';

export interface HudRegiaoSpec {
  id: string;
  papel: PapelRegiao;
  /** deslocamento do canto do painel, em pixels de 1920x1080 */
  dx: number;
  dy: number;
  w: number;
  h: number;
}

/** Origem dos painéis em 1920x1080, espelhando `apps/main/src/scan/panels.ts`. */
const ORIGEM: Record<string, { x: number; y: number }> = {
  mochila: { x: 1043, y: 271 },
  'uso-rapido': { x: 1503, y: 271 },
  'bolso-seguro': { x: 1503, y: 711 },
};

export const HUD_REGIOES: HudRegiaoSpec[] = [
  { id: 'mochila', papel: 'contador', dx: 97, dy: -45, w: 90, h: 30 },
  { id: 'uso-rapido', papel: 'contador', dx: 97, dy: -45, w: 90, h: 30 },
  { id: 'bolso-seguro', papel: 'contador', dx: 67, dy: -53, w: 110, h: 30 },
  // O total vive no cabecalho ARMAMENTO, a esquerda — fora de qualquer painel de
  // itens, entao e absoluto e nao tem `dx`.
  { id: 'armamento', papel: 'valorTotal', dx: 880, dy: 166, w: 140, h: 32 },
];

/**
 * Regiao em pixels do frame.
 *
 * O deslocamento e medido em 1920x1080 e escalado pela resolucao do frame, que
 * e a mesma premissa de `panels.ts`: a UI do ARCK escala de forma uniforme.
 */
export function regiaoHud(spec: HudRegiaoSpec, frameW: number, frameH: number): Rect {
  const ex = frameW / 1920;
  const ey = frameH / 1080;
  const base = ORIGEM[spec.id];
  const x = base ? base.x + spec.dx : spec.dx;
  const y = base ? base.y + spec.dy : spec.dy;
  return {
    x: Math.round(x * ex),
    y: Math.round(y * ey),
    width: Math.round(spec.w * ex),
    height: Math.round(spec.h * ey),
  };
}

/* ------------------------------------------------------------- interpretacao */

/**
 * Le um `x/y` de contêiner.
 *
 * ## ## ## Por que a forma e o filtro, e nao a confianca
 *
 * A confianca do Tesseract aqui e inutil: um acerto com `0/10` vem com
 * `conf=5`, e o recorte estreito demais devolve `000` com `conf=96`. Confianca
 * nao separa nada aqui.
 *
 * O que separa e a **forma**: um contador e `inteiro/inteiro`. Qualquer coisa
 * fora disso nao e contador e nao entra na tela — melhor nao mostrar do que
 * mostrar `0111`.
 */
export interface Contador {
  ocupado: number;
  capacidade: number;
}

const RE_XY = /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/;

/** Interpreta `x/y`. `null` quando nao tem a forma de contador. */
export function lerContador(texto: string): Contador | null {
  const m = RE_XY.exec(texto ?? '');
  if (!m) return null;
  const ocupado = Number(m[1]);
  const capacidade = Number(m[2]);
  if (!Number.isFinite(ocupado) || !Number.isFinite(capacidade)) return null;
  // O ocupado nunca passa da capacidade; e quando passa, o recorte pegou
  // outra coisa e o numero esta errado.
  if (ocupado > capacidade) return null;
  return { ocupado, capacidade };
}

/**
 * Interpreta o total da raid em **PT-BR**: `.` e milhar, `,` e decimal.
 *
 * Ler `43.679` como quarenta e tres virgula seiscentos e nove erraria o valor
 * por fator 1000 — e um erro silencioso, porque continua sendo um numero
 * plausivel na tela.
 *
 * `tolerance` existe porque o Tesseract troca pontuacao: `29.484` pode sair
 * `29,484`. A regiao nao tem virgula no total da raid, entao tratar virgula
 * como separador de milhar e o comportamento correto aqui — e o unico lugar
 * onde `,` **nao** e decimal.
 */
export function lerTotalBr(texto: string): number | null {
  const bruto = texto ?? '';

  /**
   * Rejeita antes de converter.
   *
   * O peso sai como `0,0/40,0` e, quando o motor troca o ponto por virgula,
   * vira `00/4002`. Tirando tudo que nao e digito sobra `004002`, e o
   * descarte de pontuacao — que existe para ler `43.679` — transforma um
   * campo que nao e total em 4002 na tela. Um `/` significa "isto e contador
   * ou peso", e nenhum dos dois e o que esta regiao mostra.
   */
  if (bruto.includes('/')) return null;

  const limpo = bruto.replace(/\s+/g, '').replace(/[^0-9.,]/g, '');
  if (!limpo || !/\d/.test(limpo)) return null;

  const soMilhar = limpo.replace(/[.,]/g, '');
  const n = Number(soMilhar);
  if (!Number.isFinite(n) || n < 0) return null;
  // Um total de raid e grande; abaixo disso provavelmente lemos outra coisa.
  if (n < 1000) return null;
  return n;
}