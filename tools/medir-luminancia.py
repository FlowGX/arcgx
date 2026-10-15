"""Por que a mascara sai vazia? Mede a luminancia real da regiao.

`mascara_numeral` usa limiar fixo 128 e devolve area 0 para os niveis 2 e 4,
mesco com o numeral comprovadamente dentro da regiao (visto em
`dados/rotulo/mapa-nivel.png`). As duas coisas nao podem ser verdade ao mesmo
tempo, entao uma das medidas esta errada.

Este script imprime, para recorte de nivel 1, 2 e 4:
- o maximo e o percentil alto de luminancia na regiao
- onde estao os pixels claros
- a luminancia no ponto exato do glifo

O glifo e desenhado em claro sobre a barra, mas a **barra muda de cor com a
raridade** — e um texto claro sobre fundo claro nao tem contraste. Se for isso,
o limiar por luminancia absoluta e o defeito: o certo e medir o contraste
*local*, ou isolar o numero pelo formato.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))
spec = importlib.util.spec_from_file_location("nivel", RAIZ / "ml" / "nivel.py")
nivel = importlib.util.module_from_spec(spec)
sys.modules["nivel"] = nivel
spec.loader.exec_module(nivel)

CAT = {}
import json  # noqa: E402

for i in (json.loads((RAIZ / "dados" / "game" / "items.json").read_text(encoding="utf-8")).get("items") or {}).values():
    CAT[i["id"]] = i.get("rarity")


def main():
    gab = nivel.pares_rotulados()
    vistos = {}
    for caminho, item in gab:
        n = nivel.nivel_do_id(item)
        vistos.setdefault(n, [])
        if len(vistos[n]) < 4:
            vistos[n].append((caminho, item))

    x0, y0, x1, y1 = nivel.REGIÃO
    print(f"regiao: x {x0}..{x1}, y {y0}..{y1}\n")

    for n in sorted(vistos):
        print(f"--- nivel {n} ---")
        for caminho, item in vistos[n]:
            im = Image.open(caminho).convert("RGB")
            a = np.asarray(im, dtype=np.float32)
            reg = a[y0:y1, x0:x1]
            lum = reg.mean(axis=2)
            ys, xs = np.where(lum > lum.max() * 0.75)
            pos = ""
            if len(xs):
                pos = f"  px claros em x {x0 + xs.min()}..{x0 + xs.max()} y {y0 + ys.min()}..{y0 + ys.max()}"
            print(
                f"  {item:<24} raridade={str(CAT.get(item)):<10} "
                f"max={lum.max():>5.0f} p99={np.percentile(lum, 99):>5.0f} "
                f"mediana={np.median(lum):>5.0f}{pos}"
            )
        print()


if __name__ == "__main__":
    main()