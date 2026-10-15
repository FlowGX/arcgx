import type { Rect } from '@arcgx/shared';

/**
 * Retangulo de um painel em FRACAO do frame, nao em pixels.
 *
 * A geometria foi medida em 1920x1080 sobre
 * `H:\Arcgxapp-ref\captures\inventario-01.png` e `inventario-02.png`,
 * conferindo visualmente cada recorte gerado por
 * `tools/ver-grade-raid.py`.
 *
 * Guardar esses numeros como pixels e o que quebraria o app em qualquer outra
 * resolucao. Medido em seis escalas - 960x540, 1280x720, 1600x900, 1920x1080,
 * 2400x1350 e 2560x1440 - o passo detectado acompanha a escala com erro de no
 * maximo 0,7 px, o que confirma que a UI escala de forma uniforme e que a
 * fracao e a representacao correta.
 */

export interface PanelRect {
  /** fracao do frame, 0..1 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelSpec {
  id: string;
  /** texto exibido no seletor */
  label: string;
  /** o que este painel e — importa para o que o app tenta fazer com ele */
  papel: 'cofre' | 'raid';
  roi: PanelRect;
  cols: number;
  rows: number;
  /**
   * Tamanho do **card** em fracao do frame.
   *
   * ## Por que o card e menor que o passo
   *
   * A ROI de 4 colunas tem 416 px de largura e o passo e 104, mas o card e
   * 92: sobram 12 px de respiro entre um card e o seguinte. Usar o passo como
   * largura inclui o respiro na recorte e o encoder passa a ver parte do
   * fundo — o que derruba a similaridade sem que nada pareca errado.
   *
   * Verticalmente o passo e 104 e o card tambem, entao encosta.
   */
  cell: { w: number; h: number };
}

/**
 * ## O que cada painel e
 *
 * A tela de inventario tem **dois** lados com numeros completamente
 * diferentes, e confundi-los produz um contador de raid que soma a coisa
 * errada:
 *
 *   - **ARMAZENAMENTO** (esquerda) e o cofre de Speranza. **Acumula entre
 *     raids**: 5.632 numa captura, 847.511 noutra, sem nenhuma raid no meio.
 *   - **ARMAMENTO** (direita) e a carga da sessao: o que voce extraiu. E o
 *     que a contagem de raid precisa somar.
 *
 * Somar o cofre e um numero que cresce sem parar e nao diz nada sobre a raid.
 */
const ARMAZENAMENTO: PanelSpec = {
  id: 'armazenamento',
  label: 'ARMAZENAMENTO (cofre)',
  papel: 'cofre',
  // ## Origem corrigida: 271, nao 367
  //
  // `tools/testar-origem.py` cortou as duas origens candidatas lado a lado: em
  // y=367 o recorte pega o card da **segunda** linha, com a borda superior
  // cortada e um item diferente. Em y=271 pega a primeira linha inteira, com
  // a borda azul fechando no recorte.
  //
  // Os 1.200 recorte8 ja rotulados foram capturados em y=367, ou seja, cobrem
  // as linhas 2..6 da grade. Sao celulas validas e consistentes entre si — por
  // isso o encoder treinado neles continua valendo — mas a origem gravada
  // mentia sobre onde a grade comeca.
  roi: {
    x: 152 / 1920,
    y: 271 / 1080,
    width: 416 / 1920,
    height: 520 / 1080,
  },
  cols: 4,
  rows: 5,
  cell: { w: 92 / 1920, h: 104 / 1080 },
};

/**
 * ## A raid, medida em `inventario-02.png`
 *
 * Os cards tem o **mesmo** tamanho dos do cofre (92x104, passo 104) e o mesmo
 * layout interno — icone de tipo a esquerda da barra, quantidade a direita,
 * numeral romano do nivel no canto. Muda so a grade e a posicao.
 *
 * Por isso o encoder treinado nos recorte8 do cofre transfere sem retrabalho.
 *
 * ## Como a medida foi conferida
 *
 * Contando os slots ocupados de cada recorte e comparando com o rotulo que o
 * proprio jogo escreve no painel:
 *
 *   MOCHILA       9 ocupados em 4x5   jogo: "9/20"
 *   USO RAPIDO    4 ocupados em 3x2   jogo: "4/5"
 *   BOLSO SEGURO  3 slots             jogo: "0/3"
 *
 * Bater com a contagem do jogo e uma verificacao independente do olho sobre a
 * captura: se a grade estivesse deslocada, os numeros nao fechariam.
 */
const MOCHILA: PanelSpec = {
  id: 'mochila',
  label: 'MOCHILA',
  papel: 'raid',
  // ## rows 6, nao 5 — a mochila cresce com upgrade
  //
  // O jogo escreve a capacidade no cabecalho e ela **muda**: `4/20` numa
  // captura, `6/22` noutra. Com 5 linhas de 104 px o ROI terminava em y=791,
  // e a 6a linha vive em y 791..895 — fora. Resultado: o app contava 4 itens
  // num slot que tinha 6, e perdia dois de municao (x60 e x40).
  //
  // Foi o contador do cabecalho que pegou isso: o `x/y` dizia 6, a contagem
  // por imagem dizia 4, e a diferenca era exatamente a linha que o ROI nao
  // cobria. Sem os dois numeros cruzados, isso passaria como "o classificador
  // errou".
  //
  // 6 linhas de 104 = 624 px, terminando em y=895. Nao colide com o
  // BOLSO SEGURO (y=711), que fica em outra coluna.
  roi: { x: 1043 / 1920, y: 271 / 1080, width: 416 / 1920, height: 624 / 1080 },
  cols: 4,
  rows: 6,
  cell: { w: 92 / 1920, h: 104 / 1080 },
};

const USO_RAPIDO: PanelSpec = {
  id: 'uso-rapido',
  label: 'USO RAPIDO',
  papel: 'raid',
  roi: { x: 1503 / 1920, y: 271 / 1080, width: 312 / 1920, height: 208 / 1080 },
  cols: 3,
  rows: 2,
  cell: { w: 92 / 1920, h: 104 / 1080 },
};

const BOLSO_SEGURO: PanelSpec = {
  id: 'bolso-seguro',
  label: 'BOLSO SEGURO',
  papel: 'raid',
  roi: { x: 1503 / 1920, y: 711 / 1080, width: 312 / 1920, height: 104 / 1080 },
  cols: 3,
  rows: 1,
  cell: { w: 92 / 1920, h: 104 / 1080 },
};

/**
 * ## O que NAO esta aqui, e por que
 *
 * `EQUIPAMENTO` e `ESPACOS APERFEICOADOS` nao entraram. Os cards sao de outro
 * tamanho e trazem a barra de durabilidade ("104/130"), o miolo do item fica
 * em outra posicao dentro da celula e a regiao do numeral muda. Entrar com a
 * grade errada e pior do que nao entrar, porque a contagem sai errada sem
 * nenhuma indicacao — foi o que aconteceu com a origem 367 do ARMAZENAMENTO,
 * que por muito tempo mascarou o erro pelo fato de o recorte continuar
 * "parecendo" uma celula.
 */
export const PAINEIS: PanelSpec[] = [ARMAZENAMENTO, MOCHILA, USO_RAPIDO, BOLSO_SEGURO];

/**
 * Painéis varridos **de uma vez**, num request só.
 *
 * ## ## ## Por que o cofre entra
 *
 * A pergunta "identificar todos os itens" inclui o ARMAZENAMENTO: ele tem 245
 * itens e é onde a base se compara com o que o jogador extraiu. Escanear só a
 * raid dava metade da resposta.
 *
 * ## ## ## Por que `EQUIPAMENTO` NAO entra
 *
 * Os cards de equipamento são de **outro tamanho** e trazem a barra de
 * durabilidade ("41/100"), que muda onde o miolo do item fica dentro da célula
 * e onde o numeral aparece. Entrar com a grade de 92x104 daria recorte errado
 * em cima de arte errada — que é pior que não entrar, porque produz valores
 * plausíveis e errados.
 *
 * Precisa da mesma medição que o resto: largura/altura do card, passo, e a
 * faixa da arte acima da barra. Quando for medido, é uma entrada nesta lista.
 */
export const PAINEIS_DE_SCAN: PanelSpec[] = PAINEIS;

export const PAINEIS_RAID: PanelSpec[] = PAINEIS.filter((p) => p.papel === 'raid');

export function painelPorId(id: string): PanelSpec | undefined {
  return PAINEIS.find((p) => p.id === id);
}

/** Retangulo do painel em pixels do frame. */
export function panelRect(spec: PanelSpec, frameW: number, frameH: number): Rect {
  return {
    x: Math.round(spec.roi.x * frameW),
    y: Math.round(spec.roi.y * frameH),
    width: Math.round(spec.roi.width * frameW),
    height: Math.round(spec.roi.height * frameH),
  };
}

/**
 * Retangulo de cada celula, em coordenadas do frame, na ordem da grade.
 *
 * ## Por que o main calcula e o worker nao infere
 *
 * O worker tinha um detector nativo que descobre cols/rows pelos pixels. No
 * painel MOCHILA, em captura real, ele devolveu uma grade **5x7** — 35 celulas
 * de 83x74 px num painel que tem 4x5 de 92x104. Nada sinalizou: o payload sai
 * com `fallback: false`, como se estivesse certo.
 *
 * A grade aqui nao e problema de deteccao, e **geometria conhecida e fixa**:
 * 4 colunas de passo 104 num painel de 416 px. Deixar o worker descobrir algo
 * que ja se sabe e trocar precisao por risco. O worker recebe os retangulos
 * prontos e so codifica.
 */
export function cellsOf(spec: PanelSpec, frameW: number, frameH: number): Rect[] {
  const roi = panelRect(spec, frameW, frameH);
  const passoX = roi.width / spec.cols;
  const passoY = roi.height / spec.rows;
  const w = Math.round(spec.cell.w * frameW);
  const h = Math.round(spec.cell.h * frameH);
  const out: Rect[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      out.push({
        x: Math.round(roi.x + c * passoX),
        y: Math.round(roi.y + r * passoY),
        width: w,
        height: h,
      });
    }
  }
  return out;
}

/**
 * ## Mantidos para compatibilidade com quem ja importa estes nomes
 *
 * `scan/loop.ts` indexa `PANELS` **por id** (`PANELS[id]`), entao aqui e um
 * record e nao a lista. `DEFAULT_PANEL` e o cofre, que e o que a captura
 * historica usou — trocar o padrao para a raid mudaria o significado de todo
 * recorte ja coletado sem avisar. Quem quiser a raid escolhe pelo id.
 */
export const PANELS: Record<string, PanelSpec> = Object.fromEntries(
  PAINEIS.map((p) => [p.id, p]),
);

export const DEFAULT_PANEL: PanelSpec = ARMAZENAMENTO;
export const ARMAZENAMENTO_PANEL = ARMAZENAMENTO;