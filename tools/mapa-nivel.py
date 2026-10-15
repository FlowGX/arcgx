"""
Onde esta o numeral? Localizado por diferenca, nao por suposicao.

## Por que este script

O leitor em `ml/nivel.py` acerta 13,1%, e a area de tinta medida e **zero**
para os niveis 2 e 4. A regiao `(58,87)-(92,104)` que eu escolhi esta errada:
em nivel 1 ela pega 24 px, nos outros nao pega nada. Nao faz sentido — um
glifo mais largo que outro nao desaparece.

Adivinhar coordenada e como se chegou no numeral apagado: eu assumi que a
janela 56..92 era "quantidade" sem olhar. Nao vou repetir.

## O metodo

O numeral **e** a diferenca entre um recorte de nivel 4 e um de nivel 1. As
duas celulas tem o mesmo layout, a mesma barra, o mesmo icone — muda so o
glifo. Entao:

    mapa[nivel] = media das mascaras dos recortes daquele nivel

e o contraste entre `mapa[4]` e `mapa[1]` marca exatamente onde o IIII
aparece. Sem hypothesis sobre posicao nenhuma.

## Cuidado com a comparacao

Nivel 1 tem 275 recorte8 e nivel 4 tem 43, e os dois grupos tem raridades
diferentes — a barra inferior muda de cor com a raridade. Por isso o mapa
bruto carrega a cor da barra, nao so o numeral. Por isso o script imprime
**todos** os niveis lado a lado: da para ver o que e numeral (aparece e
desaparece) e o que e barra (presente em todos).
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

CEL_W, CEL_H = 92, 104
ESC = 6


def main():
    gab = nivel.pares_rotulados()
    por_nivel = {}
    for caminho, item in gab:
        n = nivel.nivel_do_id(item)
        por_nivel.setdefault(n, []).append(caminho)

    print("recortes por nivel:", {n: len(v) for n, v in sorted(por_nivel.items())})

    mapas = {}
    for n, lista in por_nivel.items():
        arr = np.stack(
            [np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) for p in lista[:80]]
        )
        mapas[n] = arr.mean(axis=0)

    print()
    print("contraste por nivel (contra o nivel 1, que e o mais numerosaso):")
    base = mapas.get(1)
    for n in sorted(mapas):
        if base is None or n == 1:
            continue
        d = np.abs(mapas[n] - base).mean(axis=2)
        alto = d > 18
        ys, xs = np.where(alto)
        if len(ys):
            print(
                f"  nivel {n}: {len(ys):>4} px diferentes | "
                f"x {xs.min():>2}..{xs.max():<3} y {ys.min():>2}..{ys.max():<3}"
            )
        else:
            print(f"  nivel {n}: nada")

    # ## Painel de calor: onde o contraste vive
    if base is not None:
        linhas = []
        for n in sorted(mapas):
            if n == 1:
                continue
            d = np.abs(mapas[n] - base).mean(axis=2)
            linhas.append((n, d))
        if linhas:
            H = CEL_H * ESC
            folha = Image.new(
                "RGB", ((CEL_W * ESC + 6) * (len(linhas) + 1), H), (10, 10, 12)
            )
            colunas = [(1, np.zeros((CEL_H, CEL_W)))] + linhas
            for k, (n, d) in enumerate(colunas):
                img = Image.fromarray(np.clip(d * 6, 0, 255).astype(np.uint8)).convert("RGB")
                folha.paste(img.resize((CEL_W * ESC, H), Image.NEAREST), (k * (CEL_W * ESC + 6), 0))
            destino = RAIZ / "dados" / "rotulo" / "mapa-nivel.png"
            folha.save(destino)
            print(f"\n-> {destino}")
            print("   colunas: [nivel 1 = zero] | [contraste vs nivel 1, um por nivel acima]")


if __name__ == "__main__":
    main()