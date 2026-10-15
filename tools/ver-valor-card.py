"""
O valor aparece no card da grade, ou so no tooltip?

## A pergunta

O print mostra o valor de tres jeitos:

    ARMAZENAMENTO header : 10 itens | 5.632
    card individual      : "x5"  (so quantidade)
    tooltip (hover)      : 104/130 | 11,75 | 24.525

Se o valor estivesse escrito no card, o scan passivo daria o total da raid sem
nenhum hover — e o caminho principal viraria contagem, nao hover. Se ele so
aparece no tooltip, entao hover e obrigatorio para fechar a conta, e o
passivo fica so com o valor aproximado do catalogo.

Diferenca de arquitetura enorme. E o jeito de descobrir e o mesmo de sempre:
nao palpite, medicao. Vou放大 a barra inferior de um card nos nossos recorte8
rotulados e ver se ha numero la.

## O que da para esperar

Pelo print, o card mostra icone de tipo a esquerda e "x5" a direita — o "x5"
e **quantidade**, nao valor. O valor do item so tem lugar no tooltip. Mas
"pelo print" eExactly o tipo de conclusao que ja me deu errado nesta sessao
(o numeral, a regiao do glifo, o limiar de contraste). Vou olhar.
"""

import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
sys.path.insert(0, str(ML))
spec = importlib.util.spec_from_file_location("nivel", ML / "nivel.py")
nivel = importlib.util.module_from_spec(spec)
sys.modules["nivel"] = nivel
spec.loader.exec_module(nivel)

CAT = {}
for i in (json.loads((RAIZ / "dados" / "game" / "items.json").read_text(encoding="utf-8")).get("items") or {}).values():
    CAT[i["id"]] = i

# ## Onde olhar
#
# A celula e 92x104. A barra inferior e y 86..104. No print, o card mostra
# icone de tipo a esquerda e "x5" a direita. Se houvesse valor, estaria em
# algum dos dois lados da barra — ou acima, junto da arte.
BARRA = (0, 86, 92, 104)
ESC = 9


def main():
    gab = nivel.pares_rotulados()
    # itens caros primeiro: e onde o numero, se existir, seria mais legivel
    escolhidos = sorted(gab, key=lambda p: -(CAT.get(p[1], {}).get("value") or 0))[:8]

    larg = (BARRA[2] - BARRA[0]) * ESC
    alt = (BARRA[3] - BARRA[1]) * ESC
    folha = Image.new("RGB", ((larg + 8) * len(escolhidos), alt + 30), (12, 12, 16))
    d = ImageDraw.Draw(folha)

    print(f"recorte: {BARRA} da celula, ampliado {ESC}x")
    print("itens escolhidos por maior valor de catalogo:\n")
    for n, (caminho, item) in enumerate(escolhidos):
        info = CAT.get(item, {})
        im = Image.open(caminho).convert("RGB").crop(BARRA)
        folha.paste(im.resize((larg, alt), Image.NEAREST), (n * (larg + 8), 30))
        d.text((n * (larg + 8) + 2, 3), f"{item}", fill=(255, 220, 120))
        d.text((n * (larg + 8) + 2, 17), f"cat.val={info.get('value')}", fill=(150, 200, 150))
        print(f"  {item:<28} valor catalogo = {info.get('value')}")

    destino = RAIZ / "dados" / "rotulo" / "barra-card.png"
    folha.save(destino)
    print(f"\n-> {destino}")
    print("Se aparecer so 'x5'/'x20', o card nao tem valor e o hover e obrigatorio.")


if __name__ == "__main__":
    main()