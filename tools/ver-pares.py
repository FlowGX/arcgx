"""
Folha de pares: recorte do jogo ao lado da arte do catalogo.

## Por que olhar, e nao treinar de novo

O encoder treinado tem similaridade mediana de **0,25** com a arte do item
certo. O backbone de ImageNet, sem treino nenhum, chega a **0,63** nos
mesmos pares. Treinar piorou o alinhamento — e isso nao acontece quando o
problema e "faltam dados". Faltar dados deixa o numero baixo e estavel;
piorar apos treino significa que o objetivo esta errado.

Duas hipoteses, e so ha um jeito de decidir entre elas:

1. **O recorte nao e o icone.** A celula tem borda de raridade, barra de
   quantidade e o icone no meio. A arte do catalogo e so o icone, limpo. O
   modelo esta sendo pedido para mapear duas coisas diferentes, e nenhum
   volume de dados conserta isso.
2. **O treino esta quebrado.** BatchNorm com 324 amostras, learning rate
   alto demais, ou negativo so dentro do lote — o modelo colapsa para uma
   representacao degenerada.

A imagem separa as duas: se o recorte esta deslocado ou com moldura, e (1).
Se os icones batem e mesmo assim a similaridade e baixa, e (2).
"""

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
LOTE = RAIZ / "dados" / "rotulo" / "lote"
CACHE = RAIZ / "dados" / "rotulo" / "cache-arte"
CATALOGO = RAIZ / "dados" / "game" / "items.json"
GABARITO = RAIZ / "dados" / "rotulo" / "gabarito.json"
SAIDA = RAIZ / "dados" / "rotulo" / "pares.png"

POR_PAGINA = 12
LADO = 150


def arte_de(item):
    url = item.get("imageFilename")
    if not url:
        return None
    p = CACHE / f"{hashlib.md5(url.encode()).hexdigest()}.png"
    if not p.exists():
        return None
    try:
        return Image.open(p).convert("RGB")
    except Exception:
        return None


def main():
    itens = json.loads(CATALOGO.read_text(encoding="utf-8")).get("items") or {}
    gab = json.loads(GABARITO.read_text(encoding="utf-8"))

    pares = []
    for cap, celulas in (gab.get("capturas") or {}).items():
        for idx, item_id in (celulas or {}).items():
            if not item_id or item_id == "VAZIA":
                continue
            item = itens.get(item_id)
            if not item:
                continue
            arte = arte_de(item)
            corte = LOTE / cap / f"{idx}.png"
            if arte is None or not corte.exists():
                continue
            pares.append((Image.open(corte).convert("RGB"), arte, item_id))
            if len(pares) >= POR_PAGINA * 3:
                break
        if len(pares) >= POR_PAGINA * 3:
            break

    if not pares:
        raise SystemExit("nenhum par encontrado")

    # tres paginas: inicio, meio, fim
    fatias = [pares[:POR_PAGINA], pares[POR_PAGINA * 3 : POR_PAGINA * 4], pares[-POR_PAGINA:]]
    fatias = [f for f in fatias if f]

    largura = 2 * LADO + 30
    altura = len(fatias) * (LADO + 26)
    tela = Image.new("RGB", (largura, altura), (18, 16, 14))
    d = ImageDraw.Draw(tela)

    y = 0
    for fatia in fatias:
        for i, (recorte, arte, item_id) in enumerate(fatia):
            x = i * (LADO + 15)
            tela.paste(recorte.resize((LADO, LADO)), (x, y))
            tela.paste(arte.resize((LADO, LADO)), (x + LADO + 15, y))
            d.text((x, y + LADO + 6), item_id[:34], fill=(200, 190, 175))
        y += LADO + 26

    tela.save(SAIDA)
    print(f"pares: {sum(len(f) for f in fatias)}  ->  {SAIDA}")
    print("esquerda = recorte do jogo | direita = arte do catalogo")


if __name__ == "__main__":
    main()