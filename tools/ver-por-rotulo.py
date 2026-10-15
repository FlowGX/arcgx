"""
Os cortes com o mesmo rotulo mostram o mesmo item?

## Por que este teste decide

Duas explicacoes para "recorte de `dolabra` parece uma furadeira e a arte de
`dolabra` parece uma rifle":

1. O **rotulo esta na celula errada** — o recorte nao e o item que o
   usuario rotulou. Entao cortes com o mesmo rotulo mostram itens diferentes.
2. O **item esta trocado no catalogo** — o recorte esta certo e a arte aponta
   para outro item. Entao cortes com o mesmo rotulo mostram o MESMO item, e o
   problema esta na fonte de arte.

O teste nao precisa saber qual das duas e a verdade: basta ver se cortes de
mesmo rotulo se parecem entre si. Se se parecem, o rotulo segue a imagem e o
desalinhamento esta na arte. Se nao, o rotulo nao segue a imagem.

Se alem disso o rotulo nao segue a propria arte, entao o recorte esta
deslocado — e a culpa e da geometria de recorte, nao de ninguem que rotulou.
"""

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
LOTE = RAIZ / "dados" / "rotulo" / "lote"
CACHE = RAIZ / "dados" / "rotulo" / "cache-arte"
CATALOGO = RAIZ / "dados" / "game" / "items.json"
GABARITO = RAIZ / "dados" / "rotulo" / "gabarito.json"
SAIDA = RAIZ / "dados" / "rotulo" / "por-rotulo.png"

LADO = 110


def main():
    itens = json.loads(CATALOGO.read_text(encoding="utf-8")).get("items") or {}
    gab = json.loads(GABARITO.read_text(encoding="utf-8"))

    # rotulo -> cortes (ate 4 por rotulo)
    por_rotulo = defaultdict(list)
    for cap, celulas in (gab.get("capturas") or {}).items():
        for idx, item_id in (celulas or {}).items():
            if not item_id or item_id == "VAZIA":
                continue
            p = LOTE / cap / f"{idx}.png"
            if p.exists() and len(por_rotulo[item_id]) < 4:
                por_rotulo[item_id].append(p)

    # so rotulos com repeticao: e a repeticao que revela o desalinhamento
    repetidos = {k: v for k, v in por_rotulo.items() if len(v) >= 3}
    print(f"itens rotulados: {len(por_rotulo)}")
    print(f"com 3+ cortes   : {len(repetidos)}")
    print(f"total de cortes mostrados: {sum(len(v) for v in repetidos.values())}")

    if not repetidos:
        raise SystemExit("nenhum rotulo com 3+ cortes — nao da para testar")

    alvos = list(repetidos.items())[:8]

    cols = max(len(v) for _, v in alvos)
    largura = (cols + 1) * (LADO + 8) + 10
    altura = len(alvos) * (LADO + 22) + 10
    tela = Image.new("RGB", (largura, altura), (18, 16, 14))
    d = ImageDraw.Draw(tela)

    y = 5
    for item_id, cortes in alvos:
        # coluna 0: a arte do catalogo, uma vez
        url = (itens.get(item_id) or {}).get("imageFilename")
        arte = None
        if url:
            p = CACHE / f"{hashlib.md5(url.encode()).hexdigest()}.png"
            if p.exists():
                try:
                    arte = Image.open(p).convert("RGBA")
                    fundo = Image.new("RGBA", arte.size, (40, 38, 34, 255))
                    fundo.alpha_composite(arte)
                    arte = fundo.convert("RGB")
                except Exception:
                    arte = None
        if arte is not None:
            tela.paste(arte.resize((LADO, LADO)), (5, y))

        # colunas seguintes: os cortes rotulados com esse id
        for i, corte in enumerate(cortes):
            tela.paste(Image.open(corte).convert("RGB").resize((LADO, LADO)),
                       ((i + 1) * (LADO + 8) + 5, y))

        d.text((5, y + LADO + 4), f"{item_id[:40]}  (arte | {len(cortes)} cortes)",
               fill=(215, 205, 190))
        y += LADO + 22

    tela.save(SAIDA)
    print(f"\n-> {SAIDA}")
    print("coluna 1 = arte do catalogo | colunas 2+ = cortes rotulados com esse id")


if __name__ == "__main__":
    main()