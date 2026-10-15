"""
Nivel V / Amplified: o que o catalogo sabe e onde a paleta falha.

## O problema que ja existe, silencioso

`ml/moldura.py` mede a cor da cunha por raridade nos recorte8 rotulados. A
medida sai:

    Amplified  rgb(204, 48, 153)
    Epic       rgb(204, 48, 153)

**As duas sao identicas.** Amplified e Epic estao sendo medidos com a mesma
cor, entao o filtro de raridade — que ia ser o segundo estagio do scan —
trata um item Amplified como se fosse Epic. Nao ha erro, nao ha aviso: so um
numero que sai errado.

Se o jogo painta Amplified com cunha propria (como parece), entao a medida
esta pegando a cor de outra coisa — provavelmente porque os poucos recorte8
rotulados de Amplified tem cunha Epic, ou porque a janela de amostragem cai
fora da cunha dessa classe.

Este script responde tres coisas:
1. existe item de nivel V no catalogo (sufixo `-v`)?
2. `rarity` e `tier` discordam sobre Amplified?
3. a paleta medida tem colisao entre classes?
"""

import json
import re
from collections import Counter
from pathlib import Path

RAIZ = Path(r"H:\Arcgxapp")
NIVEL = re.compile(r"-(i|ii|iii|iv|v)$")


def main():
    cat = json.loads((RAIZ / "dados" / "game" / "items.json").read_text(encoding="utf-8"))
    itens = list((cat.get("items") or {}).values())

    print(f"itens: {len(itens)}")
    print()
    print("=== nivel pelo id ===")
    niveis = Counter()
    for i in itens:
        m = NIVEL.search(i["id"])
        niveis[m.group(1) if m else "(sem sufixo)"] += 1
    for n, q in niveis.most_common():
        print(f"  {n:<14} {q}")

    comv = [i for i in itens if i["id"].endswith("-v")]
    print(f"\nitens com sufixo -v: {len(comv)}")
    for i in comv[:8]:
        nome = (i.get("name") or {}).get("pt-BR") or (i.get("name") or {}).get("en")
        print(f"  {i['id']:<34} rarity={i.get('rarity'):<10} tier={i.get('tier'):<10} {nome}")

    print()
    print("=== rarity x tier ===")
    par = Counter((i.get("rarity"), i.get("tier")) for i in itens)
    for (r, t), q in sorted(par.items(), key=lambda x: -x[1]):
        marca = "  <-- tier nao cobre amplified" if r == "Amplified" and t != "amplified" else ""
        print(f"  rarity={str(r):<11} tier={str(t):<11} {q:>4}{marca}")

    print()
    print("=== itens Amplified ===")
    amp = [i for i in itens if i.get("rarity") == "Amplified"]
    print(f"total: {len(amp)}")
    print(f"  com arte: {sum(1 for i in amp if i.get('imageFilename'))}")
    print(f"  por tier: {dict(Counter(i.get('tier') for i in amp))}")

    print()
    print("=== colisao na paleta medida ===")
    paleta = {}
    gab = json.loads((RAIZ / "dados" / "rotulo" / "gabarito.json").read_text(encoding="utf-8"))
    for cap, celulas in (gab.get("capturas") or {}).items():
        for v in (celulas or {}).values():
            if v and v != "VAZIA":
                item = next((x for x in itens if x["id"] == v), None)
                if item:
                    paleta.setdefault(item.get("rarity"), set()).add(v)
    for r, membros in sorted(paleta.items()):
        print(f"  {r:<11} {len(membros):>3} itens rotulados")

    print()
    print("Os recorte8 por captura estao em dados/rotulo/lote/<captura>/NN.png")
    print("Para fechar o V: capturar um item Amplified e rodar ml/moldura.py de novo.")


if __name__ == "__main__":
    main()