# OCR — diagnóstico final

**Data:** 2026-10-13
**Veredito:** OCR numérica **não está pronta**. Abordagem pausada.

## O que foi construído e funciona

| peça | estado |
|---|---|
| PP-OCRv5 mobile det (4,83 MB) | carrega, ONNX válido |
| PP-OCRv5 latin rec (8,04 MB) | carrega, 836 glifos, acentos PT |
| dicionário de caracteres | correto (`ppocrv5_latin_dict.txt`) |
| pré-processamento | `(img/255−0.5)/0.5` + resize 960, **não** ImageNet |
| decodificação CTC | índice 0 = blank, medido na saída real |
| 8 regiões de tela | definidas em frações, `regioes.json` |
| leitor tipado | `ocr-regioes.py`, relógio/contador/decimal/fracão |

## Por que foi pausada

O teste que decide não é "a leitura parece certa" — é **"o valor muda entre
frame?"**. Leitura real varia; pixel fixo lido como número não.

| região | valor dominante | veredito |
|---|---|---|
| `nome_item_hover` | 91% | **frozen** — `01:31` era ícone |
| `centro_tela` | 62% | estável, suspeito |
| `hud_topo`, `hud_canto_dir` | 50% | estáveis, suspeitos |
| `painel_lateral_dir` | 33% | estáveis, suspeito |
| `inventario_contador` | 31% | **varia** — leitura real |
| `painel_lateral_esq` | 20% | **varia** — leitura real |

**2 de 8 regiones são confiáveis.** As outras 6 leem pixel fixo — e leem com
confiança alta (0,99+), porque o `rec` tem certeza sobre os pixels que recebeu.

## Os três erros, e o que cada um ensina

1. **Dicionário errado.** Peguei o primeiro que respondeu (6.623 glifos, chinês)
   em vez de casar pelos 836 que o modelo pede. Size-match, não first-match.

2. **Normalização errada.** Apliquei ImageNet num modelo que quer
   `(img−0.5)/0.5`. Degradou a detecção para uma caixa gigante. Nenhum erro,
   nenhum aviso.

3. **Filtro de leitura.** Contei vogais; reprovou `'1:31'` e aceitou
   `'NFOUP'`. Em português quase toda vogal é acentuada, e o `rec` erra
   justamente nos acentos. Virou "tem dígito" (15,9% → yield limpo).

Em nenhum dos três a pilha reclamou. O mesmo padrão de falha silenciosa já
apareceu em `startWindow()` (ninguém chamava), `vision: {available: false}`
(hardcoded) e `close` sem `preventDefault()` (destruía em vez de esconder).

## O que seria necessário para retomar

**Caixas de texto rotuladas.** O `det` do PaddleOCR foi treinado para
documento — texto sobre papel. HUD de jogo é ícone colorido sobre escuro, fora
da distribuição de treino. Um detector próprio (~3 MB) precisa de caixas
rotuladas à mão, que é o mesmo trabalho do `gabarito.json` dos itens.

Alternativa mais barata, se as regiões fixas bastarem: **filtro temporal** —
descartar leitura que não muda em N frames — isso mata os frozen, mas é
heurística sobre dado que já mostrou ser enganoso.

## Onde o esforço foi, de verdade

O classificador de itens está em caminho limpo e não depende da OCR:

- encoder MobileNetV3-Small, 1.075.232 params, **4,3 MB** ONNX
- treino na RTX 3060 validado ponta a ponta (`treinar.py --dry-run`)
- método InfoNCE: 150 itens rotulados treinam contra as 1.087 artes como
  negativas, então o modelo generaliza para o catálogo inteiro
- no app viaja **um modelo**; a galeria é dado, não peso

Falta o `gabarito.json`.