"""
Calibra a biblioteca de glifos de `ml/quantidade.py`.

## ## De onde vem cada simbolo

Duas fontes, porque **nenhuma sozinha cobre o jogo**:

1. os 1.200 recorte8 rotulados — tem muitos digitos e os romanos, mas as
   quantidades sao poucas (as capturas eram de inventario parado)
2. `H:\\Arcgxapp-ref\\captures\\inventario-02.png` — tem "x80", "x5", "x2",
   "x4", "x1", que **nao aparecem em nenhuma captura rotulada**

Sem a segunda fonte, "x80" — justamente a pilha que dominava o erro do total
— ficaria sem template.

## ## O rotulo vem do agrupamento, nao do olho

`tools/segmentar-glifos.py` agrupa os glifos por forma, sem saber o que sao.
Este script mostra cada grupo para **eu** ler e anotar. O agrupamento garante
que os 20 maiores grupos sao os simbolos que importam; o que ele nao garante
e o significado. Esse significado e leitura minha — e a unica vez que se le
aqui.

## ## Saida

`dados/rotulo/quantidade-templates.json`, que `ml/quantidade.py` carrega.
"""

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAIZ = Path(r"H:\Arcgxapp")
REF = RAIZ / ".." / "Arcgxapp-ref" / "captures"
sys.path.insert(0, str(RAIZ / "ml"))

spec = importlib.util.spec_from_file_location("quantidade", RAIZ / "ml" / "quantidade.py")
q = importlib.util.module_from_spec(spec)
sys.modules["quantidade"] = q
spec.loader.exec_module(q)

spec2 = importlib.util.spec_from_file_location("nivel", RAIZ / "ml" / "nivel.py")
nivel = importlib.util.module_from_spec(spec2)
sys.modules["nivel"] = nivel
spec2.loader.exec_module(nivel)

SAIDA = RAIZ / "dados" / "rotulo" / "quantidade-templates.json"

# ## Grade das capturas de referencia, em pixels de 1920x1080
# Mesmas medidas de `apps/main/src/scan/panels.ts`.
REFERENCIAS = [
    ("inventario-02.png", "mochila", 1043, 271, 4, 5),
    ("inventario-02.png", "uso-rapido", 1503, 271, 3, 2),
    ("inventario-02.png", "bolso-seguro", 1503, 711, 3, 1),
    ("inventario-01.png", "uso-rapido", 1503, 271, 3, 2),
    ("inventario-01.png", "bolso-seguro", 1503, 711, 3, 1),
]


def celulas_referencia():
    """Recorta as celulas das capturas de referencia e devolve os caminhos."""
    tmp = RAIZ / "dados" / "rotulo" / "ref-celulas"
    tmp.mkdir(parents=True, exist_ok=True)
    saida = []
    for arquivo, painel, x, y, cols, rows in REFERENCIAS:
        p = REF / arquivo
        if not p.exists():
            continue
        img = Image.open(p).convert("RGB")
        for j in range(rows):
            for i in range(cols):
                cx, cy = x + i * 104, y + j * 104
                cel = img.crop((cx, cy, cx + 92, cy + 104))
                arr = np.asarray(cel, dtype=np.float32)
                lum = arr.mean(axis=2)
                if float((np.abs(lum - np.median(lum)) > 25).mean()) < 0.12:
                    continue
                dest = tmp / f"{painel}-{i:02d}-{j:02d}.png"
                cel.save(dest)
                saida.append(dest)
    return saida


def coletar(caminhos):
    """
    Segmenta e agrupa os glifos de uma lista de celulas.

    ## Por que os centroides sao cortados na menor largura

    Glifos de larguras diferentes nao cabem na mesma matriz. O centroide e
    guardado so nos `min(centro, novo)` pixels e o resto e ignorado — com um
    piso de 2 px de folga para absorver a diferenca de 1 px sem estourar o
    broadcasting.
    """
    todos = []
    for p in caminhos:
        m = q.mascara(p)
        if m.sum() < nivel.AREA_MIN_GLYFO:
            continue
        for pos, g in q.segmentar(m):
            todos.append({"glifo": g, "pos": pos, "de": p.name})

    grupos = []
    for t in todos:
        g = t["glifo"]
        achou = False
        for centro, membros in grupos:
            d = q._parece(g, centro)
            if d < 0.13:
                n = len(membros)
                w = min(centro.shape[1], g.shape[1])
                centro[:, :w] = (centro[:, :w] * n + g[:, :w]) / (n + 1)
                membros.append(t)
                achou = True
                break
        if not achou:
            # 2 px de folga: glifos de mesma largura real podem diferir 1 px
            # por causa da posicao da coluna de corte
            folga = np.zeros((g.shape[0], g.shape[1] + 2), dtype=np.float32)
            folga[:, : g.shape[1]] = g
            grupos.append((folga, [t]))
    grupos.sort(key=lambda g: -len(g[1]))
    return grupos


def main():
    rotulados = nivel.pares_rotulados()
    ref = celulas_referencia()
    print(f"celulas rotuladas : {len(rotulados)}")
    print(f"celulas de referencia: {len(ref)}")

    todos = [p for p, _ in rotulados] + ref
    grupos = coletar(todos)

    print(f"\ngrupos: {len(grupos)}")
    print(f"{'#':>3} {'n':>4} {'larg':>5}  vem de")
    for n, (centro, membros) in enumerate(grupos[:20]):
        orig = Counter(m["de"].split("-")[0] for m in membros)
        fonte = max(orig, key=orig.get)
        print(f"{n:>3} {len(membros):>4} {centro.shape[1]:>5}  {fonte}")

    ## Renderiza para eu ler
    ESC = 11
    MG = 6
    mostrar = grupos[:20]
    larg_cel = max(c.shape[1] for c, _ in mostrar) + 3
    folha = Image.new(
        "RGB", ((larg_cel * ESC + 16) * len(mostrar), MG * ESC + 30), (12, 12, 16)
    )
    d = ImageDraw.Draw(folha)
    for n, (centro, membros) in enumerate(mostrar):
        img = Image.fromarray((centro * 255).astype(np.uint8)).convert("RGB")
        folha.paste(
            img.resize((centro.shape[1] * ESC, MG * ESC), Image.NEAREST),
            (n * (larg_cel * ESC + 16), 30),
        )
        d.text((n * (larg_cel * ESC + 16) + 2, 4), f"#{n}", fill=(255, 220, 120))
        d.text((n * (larg_cel * ESC + 16) + 2, 18), f"n={len(membros)}", fill=(150, 150, 160))

    destino = RAIZ / "dados" / "rotulo" / "glifos-calib.png"
    folha.save(destino)
    print(f"\n-> {destino}")
    print("\nLer e rodar:  python tools/calibrar-quantidade.py --gravar '#2=4,#3=2,...'")


if __name__ == "__main__":
    main()