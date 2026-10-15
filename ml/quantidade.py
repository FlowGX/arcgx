"""
Le a quantidade do card ("x100") com a mesma maquina do cabecalho.

## ## ## ## Por que os dois leitores viraram um so

    cabecalho (ARMAMENTO)   "139.866"    28 px de altura
    card (MOCHILA)          "x100"       ~20 px de altura

E a mesma fonte, so que em tamanho menor. `ml/digitos.py` ja normaliza cada
glifo para `CANON` **ancorado na base** antes de comparar, entao um digito de
20 px e um de 28 px produzem o mesmo vetor.

Por isso este modulo nao tem biblioteca propria: ele fatia com a mesma
funcao e casa com a **mesma** biblioteca. Digitos que faltavam no cabecalho
aparecem aqui — o "4" e o "5" so aparecem em quantidade de card.

## ## ## ## O que o teste in-game mudou

A captura ao vivo da mochila mostrou "x100", "x45" e "x80". Antes disso o
contador somava **20**, contando cada pilha como uma unidade: o total de raid
saiia errado por um fator de ordem de grandeza, e nao por pouco.

O teste tambem mostrou o outro lado: tres dos simbolos da biblioteca nunca
apareceram em nenhuma captura de calibracao, porque o cabecalho de valor tem
so 6 e 7 caracteres. Sem amostra nao ha template, e sem template o leitor
devolve `None` — nunca um numero chuteado.

## O que o ARC Tracker faz de diferente

`readSlotCounts` no modulo nativo deles devolve `{value, unreadable}`. O
`unreadable` explicito e a mesma decisao tomada aqui: quando a leitura falha,
o app mostra o que leu e o que nao leu, em vez de somar um numero inventado
que ninguem questiona.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
sys.path.insert(0, str(ML))

import digitos as D  # noqa: E402

# ## ## ## Onde esta a quantidade
#
# Medido em `dados/rotulo/qtd-regiao.png`, recorte ampliado 7x da barra
# inferior de um card real: o texto ocupa **y 80..98** e fica encostado na
# direita, com o "x" multiplicador na esquerda do primeiro digito.
#
# A regiao comeca em x=50 porque o icone de tipo fica a esquerda e nao
# interfere — mas um item cujo nome e largo empurra a quantidade? Nao: o
# valor e alinhado a direita, entao a posicao dele nao depende do nome. O
# que muda e o **numero de digitos**, e por isso a contagem de celulas e
## medida, nunca fixada.
## ## ## ## O "x" multiplicador tem de ficar de fora
#
# A regiao comecava em x=50 e pegava o "x" junto: em `qtd-regiao.png` ele
# ocupa x 58..62, e o digito comeca em ~63. Como o "x" nao e um digito, ele
# **infla a largura da celula** — a calibracao mediu 16,5 px/celula numa
# regiao de 42 px de largura, que e impossivel. Resultado: 1/4 na releitura,
# com varias celulas fatiadas em 1 so.
#
# Entao a regiao comeca **depois** do "x". Isso continua funcionando para
# qualquer quantidade porque o valor e alinhado a direita: "45" ocupa x 74..92
# e "100" ocupa x 63..92, ambas inteiras dentro de uma regiao que comeca em
# 64.
REGIAO = (64, 80, 92, 98)

# ## ## ## Portao de tinta — a defesa contra numero inventado
#
# Sem ele, celula **vazia** devolvia "80" ou "0" com confianca 1,000. Isso e
# pior que nao ler: uma pilha fantasma de 80 municoes entra na soma e ninguem
# ve, porque o resultado parece um total normal.
#
# Medido nas 20 celulas da captura ao vivo:
#
#     com texto   99 .. 121 px de tinta
#     vazias       29 px
#
# A separacao e limpa, entao 60 corta no meio com folga dos dois lados. Um
# `None` para vazia e o comportamento certo: equivale a `unreadable` do
# `readSlotCounts` do ARC Tracker.
MIN_TINTA = 60

# ## Gabarito vindo do teste ao vivo
#
# Lido de `dados/rotulo/live-painel.png` com a grade da captura real: as
# celulas ocupadas sao as duas da 3a linha (caixas douradas, "x100" e "x45") e
# as duas da 4a linha (caixas azuis, "x80" e "x80"). O `contar-live.py`
# detectou exatamente `00-03, 01-03, 00-04, 01-04`, o que confirma a grade
# sem depender deeu ler posicao a olho.
VIVOS = [
    ("mochila-00-03", "100"),
    ("mochila-01-03", "45"),
    ("mochila-00-04", "80"),
    ("mochila-01-04", "80"),
]

VAZIAS = [p.stem for p in sorted((RAIZ / "dados" / "rotulo" / "live-celulas").glob("mochila-*.png"))
          if p.stem not in {n for n, _ in VIVOS}]


def celula(nome):
    return RAIZ / "dados" / "rotulo" / "live-celulas" / f"{nome}.png"


def mascara_qtd(caminho):
    """Mesma mascara do cabecalho, na regiao da quantidade."""
    return D.mascara_branca(caminho, REGIAO)


def ler_quantidade(caminho, bib, largura=None):
    """
    Le a quantidade de um card.

    ## ## ## O terceiro parametro e a LARGURA, nao a lista de contagens

    A primeira versao chamava `ler_quantidade(c, bib, 12.0)` passando a
    **largura da celula** no lugar da lista de contagens candidatas. O
    `ler_auto` tenta iterar o argumento, o `float` levanta `TypeError`, e o
    `except Exception` do `raid.py` engole tudo e devolve `None`.

    Resultado: o contador somava 1 unidade por celula e **nao reclamava** —
    o mesmo total errado de antes da quantidade, agora com um `try` sugerindo
    que a leitura estava funcionando. Um `except` largo em volta de uma
    leitura que decide o total e o jeito mais facil de perder o sinal.

    Devolve `(texto, confianca, celulas)`, ou `(None, x, None)` quando a
    celula nao tem quantidade — que e o caso de item sem pilha.
    """
    m = mascara_qtd(caminho)
    if m.sum() < MIN_TINTA:
        return None, 0.0, None
    larguras = D.n_celulas(m, largura)
    if not larguras:
        return None, 0.0, None
    return D.ler_auto(m, larguras, bib)


def _largura_celula(bib):
    return bib.get("_largura_qtd")


def _calibrar():
    """Acrescenta os digitos de quantidade a biblioteca do cabecalho."""
    bib, meta = D.carregar()
    larguras = []
    for nome, esperado in VIVOS:
        p = celula(nome)
        if not p.exists():
            continue
        m = mascara_qtd(p)
        ini, fim = D.extensao_da_linha(m)
        larguras.append((fim + 1 - ini) / len(esperado))
        fatias = D.fatiar(m, len(esperado))
        if not fatias:
            print(f"  {nome}: nao fatiou em {len(esperado)} celulas")
            continue
        for f, c in zip(fatias, esperado):
            bib.setdefault(c, []).append(f)
        print(f"  {nome}: '{esperado}' ok ({len(esperado)} celulas)")
    if larguras:
        meta["largura_qtd"] = float(np.median(larguras))
        print(f"  largura da celula de quantidade: {meta['largura_qtd']:.1f} px")
    bib["_largura_qtd"] = meta.get("largura_qtd")
    return bib, meta


def main():
    print("calibrando quantidade a partir do teste ao vivo:")
    bib, meta = _calibrar()
    faltando = set("0123456789") - set(bib)
    print(f"\nsimbolos: {''.join(sorted(k for k in bib if not k.startswith('_')))}")
    if faltando:
        print(f"FALTANDO: {''.join(sorted(faltando))}")

    print("\nreleitura:")
    acertos = 0
    todos = sorted((RAIZ / "dados" / "rotulo" / "live-celulas").glob("mochila-*.png"))
    gt = dict(VIVOS)
    vazias = 0
    for p in todos:
        txt, conf, n = ler_quantidade(p, bib)
        esperado = gt.get(p.stem)
        if esperado is None:
            marco = "vazia ok" if txt is None else "vazia ERR"
            if p.stem in VAZIAS:
                vazias += 1 if txt is None else 0
            print(f"  {p.stem:<18} {marco:<10} -> {str(txt)}")
            continue
        ok = txt == esperado
        acertos += ok
        print(f"  {p.stem:<18} esperado '{esperado}' -> {str(txt):<6} "
              f"conf {conf:.3f} cel {n} {'ok' if ok else 'ERR'}")

    D.salvar({k: v for k, v in bib.items() if not k.startswith("_")}, meta)
    print(f"\ncom quantidade: {acertos}/{len(VIVOS)}   "
          f"celulas vazias corretamente None: {vazias}/{len(VAZIAS)}")


if __name__ == "__main__":
    main()
