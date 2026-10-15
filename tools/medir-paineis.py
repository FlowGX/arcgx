"""
Mede a grade de cada painel por deteccao, nao por palpite ocular.

## O problema

`apps/main/src/scan/panels.ts` mede **so** o ARMAZENAMENTO:

    origem (152, 367)   passo 104   4 colunas x 5 linhas   celula 96x104

E o proprio arquivo avisa: "cada painel do jogo tem sua propria grade, e isto
e so o ARMAZENAMENTO". So que os 1.200 recorte8 de treino sao **todos** do
cofre de Speranza. A raid — que e o que o usuario quer somar — e o painel da
direita: EQUIPAMENTO, MOCHILA, USO RAPIDO, ESPACOS APERFEIÇOADOS, BOLSO
SEGURO. Nenhum deles foi medido, e nenhum recorte veio de la.

## Como medir sem chutear

Os cards sao retangulos com borda sobre um fundo de painel mais escuro. A
projecao de gradiente nas direcoes x e y tem picos nas bordas de cada card, e
o **passo** e a distancia mediana entre picos vizinhos.

## ## Por que validar no ARMAZENAMENTO

O detector e um palpite automatico — so que palpite automatizado, e um palpite
pode estar errado do mesmo jeito que o olho. Entao ele roda primeiro no painel
cuja resposta ja se sabe:

    esperado: origem x=152  y=367   passo 104   4 x 5

Se o detector reproduzir isso, o mesmo detector aplicado na MOCHILA merece
credito. Se nao reproduzir, o detector esta errado e nao serve para nada — e
melhor descobrir isso aqui do que na MOCHILA, onde nao ha gabarito.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
CAPTURA = Path(r"H:\Arcgxapp-ref\captures\inventario-02.png")

# ## Candidatos: onde cada grade comeca, em pixels de 1920x1080
#
# These are the *panels'* bounding boxes, read off the capture — wide enough to
# contain the grid and narrow enough not to reach the neighbouring panel. The
# grid INSIDE is what gets detected; these are only search windows.
PAINEIS = {
    "armazenamento": {"rect": (140, 260, 480, 700), "esperado": (152, 367, 104, 4, 5)},
    "mochila": {"rect": (1030, 260, 460, 580), "esperado": None},
    "uso_rapido": {"rect": (1495, 260, 290, 240), "esperado": None},
    "bolso_seguro": {"rect": (1495, 690, 290, 130), "esperado": None},
}


def picos(proj, min_dist):
    """Indices de picos locais, com distancia minima entre eles."""
    p = proj / (proj.max() + 1e-9)
    out = []
    for i in range(1, len(p) - 1):
        if p[i] >= p[i - 1] and p[i] > p[i + 1] and p[i] > 0.18:
            if out and i - out[-1] < min_dist:
                if p[i] > p[out[-1]]:
                    out[-1] = i
            else:
                out.append(i)
    return out


def passo_de(indices):
    """Passo mediano entre picos vizinhos — robusto a um pico perdido."""
    d = np.diff(indices)
    d = d[d > 4]
    return float(np.median(d)) if len(d) else 0.0


def medir_grade(img, rect):
    # o dict declara (x, y, largura, altura); PIL quer (left, upper, right, lower)
    x0, y0, w, h = rect
    rect = (x0, y0, x0 + w, y0 + h)
    g = np.asarray(img.convert("L").crop(rect), dtype=np.float32)

    # gradiente nas duas direcoes: bordas de card
    gx = np.abs(np.diff(g, axis=1)).sum(axis=0)
    gy = np.abs(np.diff(g, axis=0)).sum(axis=1)

    px, py = picos(gx, 20), picos(gy, 20)
    px_i, py_i = passo_de(px), passo_de(py)

    return {
        "origem_x": x0 + px[0] if px else None,
        "origem_y": y0 + py[0] if py else None,
        "passo_x": round(px_i, 1),
        "passo_y": round(py_i, 1),
        "colunas": int(round((len(px) - 1) * w / px_i)) if px_i else 0,
        "picos_x": len(px),
        "picos_y": len(py),
    }


def main():
    img = Image.open(CAPTURA).convert("RGB")
    print(f"captura: {CAPTURA.name} {img.size}\n")

    for nome, spec in PAINEIS.items():
        r = spec["rect"]
        res = medir_grade(img, r)
        print(f"--- {nome} ---")
        print(f"  origem      ({res['origem_x']}, {res['origem_y']})")
        print(f"  passo       {res['passo_x']} x {res['passo_y']}")
        print(f"  picos x/y   {res['picos_x']} / {res['picos_y']}")
        esp = spec["esperado"]
        if esp:
            ex, ey, ep, ec, el = esp
            ok_x = res["origem_x"] is not None and abs(res["origem_x"] - ex) <= 12
            ok_y = res["origem_y"] is not None and abs(res["origem_y"] - ey) <= 12
            ok_p = abs(res["passo_x"] - ep) <= 6
            print(f"  esperado    ({ex}, {ey}) passo {ep} {ec}x{el}")
            print(f"  VALIDACAO   origem_x {'ok' if ok_x else 'ERRO'}  "
                  f"origem_y {'ok' if ok_y else 'ERRO'}  passo {'ok' if ok_p else 'ERRO'}")
        print()


if __name__ == "__main__":
    main()