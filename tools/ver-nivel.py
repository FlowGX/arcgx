"""
O numeral romano esta no recorte? Verificacao, nao suposicao.

## O que estava errado no desenho

Falei que "estilete I / estilete II" sao indistinguiveis para o encoder porque
as imagens sao as mesmas. Isso e verdade **para a arte do catalogo** — a arte
nao tem nivel. Mas o recorte do jogo tem: todo item com nivel mostra o numero
romano no canto inferior direito do icone, dentro da celula.

Se o numeral esta no pixel, a desambiguacao deixa de exigir rotulo: basta ler
o canto, que e uma regiao pequena e fixa. E o encoder nao a ve porque reduz
92x104 para 112x112 com resize bilinear — o numero tem poucos pixels de
altura e some no reamostramento.

Este script recorta o canto inferior direito da AREA DO ITEM (acima da barra de
quantidade) e amplia, para a presenca do numeral ser vista e nao lembrada.
"""

import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
sys.path.insert(0, str(ML))

import moldura as M  # noqa: E402

# canto inferior direito da area do item, nao da barra de quantidade
CAIXA = (0, 0, M.CELULA_W, M.CELULA_H)
ESC = 7

# itens escolhidos por nivel, para comparar levels diferentes E iguais
ALVOS = [
    "torrente-i",
    "burletta-ii",
    "burletta-iv",
    "renegade-iv",
    "tempest-iv",
    "snap-hook",
]


def main():
    gab = json.loads((RAIZ / "dados" / "rotulo" / "gabarito.json").read_text(encoding="utf-8"))
    cat = json.loads((RAIZ / "dados" / "game" / "items.json").read_text(encoding="utf-8"))
    tiers = {i["id"]: i.get("tier") for i in (cat.get("items") or {}).values()}

    achados = []
    for alvo in ALVOS:
        melhor = None
        for cap, celulas in (gab.get("capturas") or {}).items():
            for k, item in (celulas or {}).items():
                if item != alvo:
                    continue
                p = RAIZ / "dados" / "rotulo" / "lote" / cap / f"{k}.png"
                if p.exists() and (melhor is None or len(p.name) < len(melhor[0].name)):
                    melhor = (p, cap, k)
        if melhor is None:
            continue
        p = melhor[0]
        im = Image.open(p).convert("RGB")
        achados.append((alvo, tiers.get(alvo, "?"), im, p))

    if not achados:
        print("nenhum recorte对这些 itens")
        return

    larg = (M.ITEM_X1 - CAIXA[0]) * ESC
    alt = (CAIXA[3] - CAIXA[1]) * ESC
    folha = Image.new("RGB", ((larg + 10) * len(achados), alt + 26), (14, 14, 18))
    from PIL import ImageDraw

    d = ImageDraw.Draw(folha)
    for n, (alvo, tier, im, p) in enumerate(achados):
        canto = im.crop(CAIXA).resize((larg, alt), Image.NEAREST)
        folha.paste(canto, (n * (larg + 10), 26))
        d.text((n * (larg + 10) + 2, 4), f"{alvo}  [{tier}]", fill=(255, 220, 120))
        d.text((n * (larg + 10) + 2, 15), f"{p.parent.name}/{p.stem}", fill=(150, 150, 160))

    destino = RAIZ / "dados" / "rotulo" / "canto-nivel.png"
    folha.save(destino)
    print(f"recorte: {CAIXA} da celula, ampliado {ESC}x")
    for alvo, tier, im, p in achados:
        print(f"  {alvo:<18} tier={tier}")
    print(f"\n-> {destino}")


if __name__ == "__main__":
    main()