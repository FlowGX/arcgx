"""
Le o total da raid do cabecalho do ARMAMENTO.

## ## A arquitetura que isso troca

`ml/contar-live.py` soma item por item e deu 39.600 contra os 139.866 que o
jogo mostra. A causa nao e identificacao errada: e que cada pilha foi contada
como **uma** unidade, quando o card diz "x80".

Ler a quantidade do card e o caso que o OCR ja demonstrado perder: dois a tres
digitos, poucos pixels de altura, e o "x" **colado** no primeiro digito — em
`tools/segmentar-glifos.py` o "x80" virou um blob unico de 24 px, sem como
separar os glifos.

O total do cabecalho e o oposto: um numero so, texto grande, alto contraste,
campo fixo. E e o numero que o usuario quer para fechar a sessao.

Entao: **o encoder diz o que cada celula e** (util, com ~50% de acerto).
**O OCR do cabecalho diz quanto vale no total** (exato, porque le o que o
jogo ja calculou — inclusive acessorios e desgaste, que o catalogo nao tem).

Os dois rodam juntos; para fechar a raid, so o segundo importa.

## ## Por que reusar `ml/ocr-regioes.py`

A primeira versao reimplementou detector e reconhecedor e afundou em tres
detalhes: largura nao multipla de 32, altura nao multipla de 32, e — o que
derrubou de vez — a saida do DBNet nao e uma lista de caixas, e um **mapa de
probabilidade** `(1, 1, H, W)` que precisa de componentes conectados.

`ocr-regioes.py` ja resolve os tres. Duplicar detector de OCR foi exatamente o
erro que a sessao pagou varias vezes com o encoder.
"""

import importlib.util
import re
import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))

spec = importlib.util.spec_from_file_location("ocr_regioes", RAIZ / "ml" / "ocr-regioes.py")
ocr = importlib.util.module_from_spec(spec)
sys.modules["ocr_regioes"] = ocr
spec.loader.exec_module(ocr)

# ## ## Onde esta o total
#
# O cabecalho de ARMAMENTO tem duas linha: o titulo, e abaixo o peso e o
# valor. O valor e o ultimo da segunda linha. Medido em
# `inventario-01.png` e `inventario-02.png`, que tem "139.866" e "139.866" /
# "10.390" em capturas diferentes.
#
# As fracoes sao de 1920x1080, como o resto de `apps/main/src/scan/panels.ts`.
# A janela e generosa de proposito: sobra para o detector e e melhor do que
# cortar o numero ao meio.
REGIOES = [
    {
        "id": "armamento_valor",
        "x": 900 / 1920,
        "y": 168 / 1080,
        "width": 260 / 1920,
        "height": 37 / 1080,
    }
]


def limpar_numero(texto):
    """
    Extrai o inteiro de uma leitura como "139.866" ou "139,866".

    O jogo escreve o separador de milhar com ponto em pt-BR e com virgula em
    outros idiomas. Aceitar os dois evita refazer isso se o usuario trocar de
    idioma no jogo.

    O ponto aqui e ambiguo por natureza — "1.500" pode ser mil e quinhentos ou
    um e cinco com ponto. Assumir milhar e a leitura do padrao do jogo; o
    `peso` vem antes no mesmo cabecalho e da contexto.
    """
    limpo = re.sub(r"[^0-9.,]", "", texto)
    if not limpo:
        return None
    limpo = limpo.replace(".", "").replace(",", "")
    return int(limpo) if limpo.isdigit() else None


def juntar_linha(caixas, unclip=1.6):
    """
    Expande as caixas na horizontal e junta as que se sobrepoem numa linha.

    ## ## Sem isso o OCR le lixo com confianca alta

    O detector devolve **uma caixa por caractere**. Numa regiao com "139.866"
    ele achou 7 caixas, e o reconhecedor leu "241", "p9", "97", "24", "A1",
    "97", "67" — todos com confianca 0,90 a 0,99. A regiao estava correta, o
    recorte estava correto, e mesmo assim o numero saiu errado.

    Isso e o mesmo modo de falha de `ml/DIAGNOSTICO-OCR.md`: leitura falsa
    com confianca alta. Ele nao tem como ser detectado por limiar de
    confianca, porque a confianca **e** alta.

    O `unclip` e o passo que falta: expande cada caixa por `unclip` na
    horizontal (a altura nao muda, porque os caracteres tem a mesma) e junta
    as que se sobrepoem na mesma linha. E o que transforma 7 caixas em 1.
    """
    if not caixas:
        return []
    # y medio define a linha
    cy = sum((b[1] + b[3]) / 2 for b in caixas) / len(caixas)
    mesma = [b for b in caixas if abs((b[1] + b[3]) / 2 - cy) < max(12, (b[3] - b[1]) * 0.8)]

    ordenadas = sorted(mesma, key=lambda b: b[0])
    fundidas = []
    for b in ordenadas:
        w = (b[2] - b[0]) * unclip
        x1, x2 = b[0] - (w - (b[2] - b[0])) / 2, b[2] + (w - (b[2] - b[0])) / 2
        if fundidas and x1 <= fundidas[-1][2] + 2:
            f = fundidas[-1]
            fundidas[-1] = (min(f[0], x1), min(f[1], b[1]), max(f[2], x2), max(f[3], b[3]))
        else:
            fundidas.append((x1, b[1], x2, b[3]))
    return fundidas


def main():
    if len(sys.argv) < 2:
        print("uso: ler-total-raid.py <frame.png> [--celulas N]")
        return
    frame = Path(sys.argv[1])
    img = Image.open(frame).convert("RGB")
    print(f"frame: {frame.name} {img.size}")

    ## ## ## ## ## ## A regiao e derivada do frame; a unica entrada escrita no
    ## codigo e o gabarito dos numeros de calibracao
    #
    # Esta versao tinha a sua propria caixa em x=944. `digitos.py` tinha
    ## x=944 tambem, entao os dois concordavam e o teste dava 4/4 — mas a
    ## caixa so pegava a **cauda** do numero. Em `mask-debug.png` o recorte
    ## comeca em "866", nao em "139.866".
    ##
    ## E cao de x=944 nao era soshift: a caixa original em x=900 pegava o
    ## titulo "ARMAMENTO" junto com a linha do valor, porque a faixa
    ## vertical cobria as duas linhas do cabecalho.
    ##
    ## Agora `caixa_de` deriva a regiao por pixel (faixa so da linha do valor,
    ## junta o que esta a menos de 6 px, pega o ultimo bloco) e funciona com
    ## qualquer frame. O que fica escrito aqui e so o gabarito, e ele serve
    ## para conferir — nao para cortar.
    spec = importlib.util.spec_from_file_location("digitos", RAIZ / "ml" / "digitos.py")
    dg = importlib.util.module_from_spec(spec)
    sys.modules["digitos"] = dg
    spec.loader.exec_module(dg)

    args = sys.argv[2:]
    rotulo = "armazenamento" if "--cofre" in args else None

    box = dg.caixa_de(Path(frame).name, rotulo, base=Path(frame).parent)
    if box is None:
        print("nao achei a linha do valor no cabecalho")
        return

    recorte = img.crop(box)
    saida = RAIZ / "dados" / "rotulo" / "total-regiao.png"
    recorte.resize((recorte.width * 6, recorte.height * 6), Image.NEAREST).save(saida)
    print(f"regiao derivada {box} -> {recorte.size}  ({saida.name})")

    bib, meta = dg.carregar()
    if not bib:
        print("biblioteca vazia — rode: python ml/digitos.py")
        return
    largura = meta.get("largura_celula")
    faltando = set("0123456789") - set(bib)
    if faltando:
        print(f"aviso: faltam os digitos {''.join(sorted(faltando))}; "
              f"esses numeros voltam None em vez de palpite")

    m = dg.mascara_branca(frame, box)
    txt, conf, celulas = dg.ler_auto(m, dg.n_celulas(m, largura), bib)
    n = dg.como_numero(txt)

    if n is None:
        print("\nnao leu — nenhuma contagem de celula casou inteira")
        return

    print(f"\nTOTAL DA RAID: {n:,}   (celulas={celulas} conf {conf:.3f})")
    print("Este e o valor que o jogo calcula — ja inclui acessorios e o")
    print("desgaste. E a referencia para validar a soma por item.")


if __name__ == "__main__":
    main()