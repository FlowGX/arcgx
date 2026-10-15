"""
Mostra a mascara e a segmentacao de cada regiao numerica.

## Por que

`ml/digitos.py` calibrou 1 de 8 regioes. O ARMAMENTO, que era a mais
importante, segmentou 4 blocos onde o numero tem 6 digitos — os digitos estao
se tocando, ou a regao esta pegando parte do icone.

Ajustar limiar no escuro e a forma de errar de novo. Ver a mascara diz onde
esta o problema: se a regao esta errada, da para ver o recorte; se a
segmentacao esta errada, da para ver os blocos colados.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))
spec = importlib.util.spec_from_file_location("digitos", RAIZ / "ml" / "digitos.py")
dg = importlib.util.module_from_spec(spec)
sys.modules["digitos"] = dg
spec.loader.exec_module(dg)


def main():
    ESC = 3
    itens = []
    for arquivo, box, esperado in dg.NUMEROS_CONHECIDOS:
        p = dg.CAPTURAS / arquivo
        if not p.exists():
            continue
        original = Image.open(p).convert("RGB").crop(box)
        m = dg.mascara_branca(p, box)
        blocos = dg.segmentar(m)
        itens.append((f"{arquivo[:12]} {esperado}", original, m, blocos, box))

    larg = max(i[1].width for i in itens) * ESC
    alt = sum(i[1].height * ESC + 34 for i in itens)
    folha = Image.new("RGB", (larg * 2 + 20, alt), (12, 12, 16))
    d = ImageDraw.Draw(folha)

    y = 0
    for nome, original, m, blocos, box in itens:
        h = original.height * ESC
        folha.paste(original.resize((original.width * ESC, h), Image.NEAREST), (0, y + 26))
        img_mask = Image.fromarray((m * 255).astype(np.uint8)).convert("RGB")
        folha.paste(img_mask.resize((m.shape[1] * ESC, h), Image.NEAREST),
                    (larg + 20, y + 26))
        d.text((2, y + 4), f"{nome}   blocos={len(blocos)}  box={box}", fill=(255, 220, 120))

        ## marca onde comecou cada bloco na mascara
        x = 0
        for g in blocos:
            # recalcula a posicao pelo run de colunas
            cols = g.any(axis=0)
            d.line([(larg + 20 + x * ESC, y + 26), (larg + 20 + x * ESC, y + 26 + h)],
                   fill=(255, 60, 60), width=1)
            x += g.shape[1]
        y += h + 34

    destino = RAIZ / "dados" / "rotulo" / "regioes-mascara.png"
    folha.save(destino)
    print(f"-> {destino}")
    print("esquerda = recorte real | direita = mascara, com as divisoes em vermelho")
    print("\n(um bloco vermelho = um digito; se o numero tem 6 e so aparecem")
    print(" 4 blocos, os digitos estao se tocando e precisam ser separados)")


if __name__ == "__main__":
    main()