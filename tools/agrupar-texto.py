"""
Le a quantidade do card ("x80") por agrupamento de formas, sem OCR.

## ## Por que nao OCR

`ml/DIAGNOSTICO-OCR.md` ja-accounted que ler numero em regiao pequena de icone
dava leitura falsa com alta confianca. A quantidade esta no mesmo tipo de
lugar: dois a tres digitos, poucos pixels de altura, encostados na barra.

Sao duas opcoes reais: template por digito, ou OCR. O OCR aqui e o modelo
latin que ja temos, e ele erra exatamente no caso numerico curto — foi o que
fez o diagnostico parar.

## ## Por que agrupamento

Nao tenho ground truth de digito: ninguem rotulou "esta celula tem 80". Mas os
digitos **se repetem** em centenas de celulas, e a mesma quantidade reaparece
em capturas diferentes. Entao:

1. extrai a regiao da direita da barra de todas as celulas
2. agrupa as mascaras por similaridade
3. os grupos grandes sao os digitos, nao o ruido

O agrupamento e nao-supervisionado: ele descobre quantos simbolos existem sem
saber quais sao. Depois eu **leio** os centroides (sao poucos, e legiveis) e
associo grupo -> digito uma vez so. Essa associacao e o unico rotulo que
existe aqui, e e de 7 ou 8 simbolos, nao de 1.200 celulas.

## ## O numero romano tambem aparece aqui

A direita da barra e onde fica o glifo do nivel **ou** a quantidade. Os dois
sao texto claro com posicao parecida. Por isso os grupos sao apresentados
juntos: o que se ve e um digito ou um romano, e a leitura de cada cluster
distingue um do outro.
"""

import importlib.util
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))
spec = importlib.util.spec_from_file_location("nivel", RAIZ / "ml" / "nivel.py")
nivel = importlib.util.module_from_spec(spec)
sys.modules["nivel"] = nivel
spec.loader.exec_module(nivel)

# ## Onde esta o texto da direita da barra
#
# A barra e y 86..104. Pelas medidas de `tools/medir-luminancia.py` o texto
# (numeral ou quantidade) vive em x 74..90. A janela e um pouco maior porque a
# quantidade "x80" e mais larga que o glifo "IV".
REGIAO = (70, 87, 92, 103)


def mascara(caminho):
    im = Image.open(caminho).convert("RGB").crop(REGIAO)
    lum = np.asarray(im, dtype=np.float32).mean(axis=2)
    fundo = float(np.median(lum))
    return (np.abs(lum - fundo) > max(18.0, fundo * 0.55)).astype(np.float32)


def agrupar(mascaras, limiar=0.14):
    """Agrupamento guloso: o primeiro membro vira o centroide do grupo."""
    grupos = []  # (centroide, [indices])
    for i, m in enumerate(mascaras):
        melhor, dist = None, 1.0
        for g, (centro, _) in enumerate(grupos):
            d = float(np.abs(m - centro).mean())
            if d < dist:
                melhor, dist = g, d
        if melhor is not None and dist < limiar:
            centro, membros = grupos[melhor]
            grupos[melhor] = ((centro * len(membros) + m) / (len(membros) + 1),
                              membros + [i])
        else:
            grupos.append((m.copy(), [i]))
    return grupos


def main():
    pares = nivel.pares_rotulados()
    mascaras = [mascara(p) for p, _ in pares]
    quantas_vazias = sum(1 for m in mascaras if m.sum() < nivel.AREA_MIN_GLYFO)
    print(f"celulas: {len(mascaras)}   sem tinta na regiao: {quantas_vazias}")

    ativos = [m for m in mascaras if m.sum() >= nivel.AREA_MIN_GLYFO]
    grupos = agrupar(ativos)
    grupos.sort(key=lambda g: -len(g[1]))

    print(f"\ngrupos: {len(grupos)}")
    print(f"{'#':>3} {'n':>4} {'area':>6}   exemplo de item")
    for n, (centro, membros) in enumerate(grupos[:14]):
        item = next((pares[i][1] for i in membros), "?")
        print(f"{n:>3} {len(membros):>4} {centro.sum():>6.0f}   {item}")

    ## Renderiza os centroides para eu ler
    ESC = 9
    W = REGIAO[2] - REGIAO[0]
    H = REGIAO[3] - REGIAO[1]
    mostrar = grupos[:14]
    folha = Image.new("RGB", ((W * ESC + 14) * len(mostrar), H * ESC + 30), (12, 12, 16))
    d = ImageDraw.Draw(folha)
    for n, (centro, membros) in enumerate(mostrar):
        img = Image.fromarray((centro * 255).astype(np.uint8)).convert("RGB")
        folha.paste(img.resize((W * ESC, H * ESC), Image.NEAREST), (n * (W * ESC + 14), 30))
        d.text((n * (W * ESC + 14) + 2, 4), f"#{n} n={len(membros)}", fill=(255, 220, 120))
        d.text((n * (W * ESC + 14) + 2, 18), f"area={centro.sum():.0f}", fill=(150, 150, 160))

    destino = RAIZ / "dados" / "rotulo" / "clusters-texto.png"
    folha.save(destino)
    print(f"\n-> {destino}")
    print("\nCada bloco e um simbolo distinto. Ler e anotar: '#N = ?'")


if __name__ == "__main__":
    main()