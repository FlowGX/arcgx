"""
Grade sobre um recorte real, para ler a caixa do sprite e as areas de ruido.

A medicao por mediana mostrou que a celula nao tem moldura constante: o arco
de raridade (canto inferior esquerdo, grande) e o texto de quantidade (direita,
em branco) mudam de item para item. Isso significa que "descartar a moldura"
nao e，不可能: e preciso saber onde cada um dessas pecas esta.

Este script upscale um recorte e desenha uma grade a cada 10 px com o
numero, para a caixa ser lida no olho em vez de chutada.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAIZ = Path(r"H:\Arcgxapp")


def _carregar(nome, caminho):
    spec = importlib.util.spec_from_file_location(nome, caminho)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod


t = _carregar("treinar", RAIZ / "ml" / "treinar.py")

ESC = 6
PASSO = 10


def com_grade(im):
    W, H = im.size
    out = im.resize((W * ESC, H * ESC), Image.NEAREST)
    d = ImageDraw.Draw(out)
    for x in range(0, W + 1, PASSO):
        d.line([(x * ESC, 0), (x * ESC, H * ESC)], fill=(255, 0, 0), width=1)
        d.text((x * ESC + 2, 2), str(x), fill=(255, 255, 0))
    for y in range(0, H + 1, PASSO):
        d.line([(0, y * ESC), (W * ESC, y * ESC)], fill=(0, 160, 255), width=1)
        d.text((2, y * ESC + 2), str(y), fill=(0, 255, 255))
    return out


def main():
    gab = json.loads((RAIZ / "dados" / "rotulo" / "gabarito.json").read_text(encoding="utf-8"))
    caps = gab.get("capturas") or {}

    # tres itens bem diferentes entre si, com recorte em celula 0
    escolhida = {}
    for cap, celulas in caps.items():
        for idx, item in (celulas or {}).items():
            if str(idx) not in ("00", "0"):
                continue
            if not item or item == "VAZIA" or item in escolhida:
                continue
            p = t.LOTE / cap / f"{idx}.png"
            if p.exists():
                escolhida[item] = p
        if len(escolhida) >= 3:
            break

    if not escolhida:
        print("sem recorte de celula 0")
        return

    ladrilhos = []
    for item, p in list(escolhida.items())[:3]:
        im = Image.open(p).convert("RGB")
        ladrilhos.append(com_grade(im))
        print(f"{item:<22} {p.name}  {im.size[0]}x{im.size[1]}")

    W = max(i.size[0] for i in ladrilhos)
    H = sum(i.size[1] for i in ladrilhos)
    folha = Image.new("RGB", (W, H), (20, 20, 20))
    y = 0
    for i in ladrilhos:
        folha.paste(i, (0, y))
        y += i.size[1]

    destino = RAIZ / "dados" / "rotulo" / "grade-celula.png"
    folha.save(destino)
    print(f"\n-> {destino}   (vermelho = x, azul = y, a cada {PASSO}px)")


if __name__ == "__main__":
    main()