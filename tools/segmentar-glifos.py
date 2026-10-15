"""
Segmenta a regiao de texto da barra em glifos individuais.

## ## O problema com o agrupamento de string inteira

`tools/agrupar-texto.py` agrupa a mascara **inteira** da regiao. Achou os
simbolos que existem nos dados — "IV", "I", "20", "x9", "x50" — mas cada grupo
e uma string completa. Um "x7" nunca aparece nos 1.200 recorte8, entao nao
tem grupo, e o leitor devolve nada.

Isso nao generaliza: a qualquer momento aparece "x12", "x33", "x7".

## ## Por que segmentar em glifos resolve

O texto e renderizado em fonte monoespacada, entao os glifos tem a mesma
largura e estao alinhados. Cortando por **colunas vazias** dentro da mascara,
cada digito sai como um bloco proprio. Os grupos passam a ser **digitos**, que
sao um conjunto fechado: 10 possibilidades, e nao uma string nova a cada
captura.

Depois: grupo -> digito, lido **uma vez**. E o unico rotulo manual do caminho
inteiro, e sao 10.

## ## O "x" e um glifo a parte

A quantidade vem como "x80": o "x" e multiplicador, nao digito. Ele aparece
sempre no inicio, com o mesmo desenho. Se ele entrar no mesmo agrupamento dos
digitos, vira um "digito" ambiguo — e o leitor pode devolver "x80" como um
numero so. Entao o primeiro glifo e separado por posicao, e so os glifos
seguintes entram no vocabulario de digitos.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))
spec = importlib.util.spec_from_file_location("nivel", RAIZ / "ml" / "nivel.py")
nivel = importlib.util.module_from_spec(spec)
sys.modules["nivel"] = nivel
spec.loader.exec_module(nivel)

REGIAO = (70, 87, 92, 103)


def mascara(caminho):
    im = Image.open(caminho).convert("RGB").crop(REGIAO)
    lum = np.asarray(im, dtype=np.float32).mean(axis=2)
    fundo = float(np.median(lum))
    return (np.abs(lum - fundo) > max(18.0, fundo * 0.55)).astype(np.float32)


def glifos(m):
    """
    Recorta a mascara em blocos por colunas vazias.

    Devolve a lista de (x_inicial, bloco). Bloco vazio e ignorado.
    """
    cols = m.any(axis=0)
    if not cols.any():
        return []
    saida = []
    dentro = False
    for x, v in enumerate(cols):
        if v and not dentro:
            inicio, dentro = x, True
        elif not v and dentro:
            dentro = False
            saida.append((inicio, m[:, inicio:x]))
    if dentro:
        saida.append((inicio, m[:, inicio:]))
    return saida


def main():
    pares = nivel.pares_rotulados()
    mascaras = [mascara(p) for p, _ in pares]

    ## Junta todos os glifos, com a posicao dentro da regiao
    todos = []
    for i, m in enumerate(mascaras):
        if m.sum() < nivel.AREA_MIN_GLYFO:
            continue
        for pos, g in glifos(m):
            todos.append({"glifo": g, "pos": pos, "largura": g.shape[1], "item": pares[i][1]})

    print(f"celulas com tinta: {sum(1 for m in mascaras if m.sum() >= nivel.AREA_MIN_GLYFO)}")
    print(f"glifos segmentados: {len(todos)}")

    larguras = np.array([t["largura"] for t in todos])
    print(f"largura dos glifos: min {larguras.min()} mediana {int(np.median(larguras))} max {larguras.max()}")
    import collections

    print("histograma de largura:")
    for w, c in sorted(collections.Counter(larguras.tolist()).items()):
        print(f"  {w} px: {c}")

    ## Agrupa por forma
    grupos = []
    for t in todos:
        melhor, dist = None, 1.0
        for g, (centro, membros) in enumerate(grupos):
            d = float(np.abs(t["glifo"] - centro[:, : t["glifo"].shape[1]]).mean()) if t["glifo"].shape[1] <= centro.shape[1] else 1.0
            if d < dist:
                melhor, dist = g, d
        if melhor is not None and dist < 0.13:
            centro, membros = grupos[melhor]
            n = len(membros)
            w = t["glifo"].shape[1]
            novo = centro.copy()
            novo[:, :w] = (novo[:, :w] * n + t["glifo"]) / (n + 1)
            grupos[melhor] = (novo, membros + [t])
        else:
            grupos.append((t["glifo"].copy(), [t]))

    grupos.sort(key=lambda g: -len(g[1]))
    print(f"\ngrupos de glifo: {len(grupos)}")
    print(f"{'#':>3} {'n':>4} {'larg':>5}  exemplo")
    for n, (centro, membros) in enumerate(grupos[:16]):
        print(f"{n:>3} {len(membros):>4} {centro.shape[1]:>5}  {membros[0]['item']}")

    ESC = 11
    MG = 6
    mostrar = grupos[:16]
    largura_cel = max(c.shape[1] for c, _ in mostrar) + 3
    W = (largura_cel * ESC + 16) * len(mostrar)
    folha = Image.new("RGB", (W, MG * ESC + 30), (12, 12, 16))
    d = ImageDraw.Draw(folha)
    for n, (centro, membros) in enumerate(mostrar):
        img = Image.fromarray((centro * 255).astype(np.uint8)).convert("RGB")
        folha.paste(
            img.resize((centro.shape[1] * ESC, MG * ESC), Image.NEAREST),
            (n * (largura_cel * ESC + 16), 30),
        )
        d.text((n * (largura_cel * ESC + 16) + 2, 4), f"#{n}", fill=(255, 220, 120))
        d.text((n * (largura_cel * ESC + 16) + 2, 18), f"n={len(membros)}", fill=(150, 150, 160))

    destino = RAIZ / "dados" / "rotulo" / "glifos.png"
    folha.save(destino)
    print(f"\n-> {destino}")


if __name__ == "__main__":
    main()