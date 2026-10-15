"""
Mede a geometria interna da celula para montar a moldura.

## Por que medir antes de sintetizar

A ideia da opcao 2 e treinar o recorte do jogo contra a arte do catalogo
**colocada na mesma moldura** — fundo escuro, arco de raridade, barra de
quantidade. Assim o unico delta entre as duas entradas e o proprio objeto.

Para fazer isso preciso saber, dentro de cada celula:
1. a que pixels sao moldura (fixos, iguais em todos os itens)
2. a que pixels e o item (mudam de item para item)
3. onde o sprite costuma ficar e com que tamanho

A resposta para (1) e (2) sai de um truque: **mediana por indice de celula**.
Cada celula da grade tem ~60 recortes, de itens diferentes. A moldura e igual
em todos; o sprite nao. A mediana pixel a pixel de 60 itens diferentes deixa
a moldura intacta e transforma a area do sprite numa borra escura — porque
naqueles pixels nenhum item domina a mediana.

O desvio padrao por pixel completa o mapa: baixo onde e moldura, alto onde
e item. E o limiar entre um e outro diz a caixa do sprite.

Este script so mede e salva a visualizacao. A sintese vem depois, com a
caixa ja conhecida em vez de chutada.
"""

import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")


def _carregar(nome, caminho):
    spec = importlib.util.spec_from_file_location(nome, caminho)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod


t = _carregar("treinar", RAIZ / "ml" / "treinar.py")


def main():
    gab = json.loads((RAIZ / "dados" / "rotulo" / "gabarito.json").read_text(encoding="utf-8"))
    caps = gab.get("capturas") or {}

    # (indice de celula) -> [array]
    por_celula = defaultdict(list)
    for cap, celulas in caps.items():
        for idx, item in (celulas or {}).items():
            p = t.LOTE / cap / f"{idx}.png"
            if p.exists():
                im = Image.open(p).convert("RGB")
                por_celula[idx].append((item, np.asarray(im, dtype=np.float32)))

    if not por_celula:
        print("nenhum recorte")
        return

    amostra = next(iter(por_celula.values()))[0][1]
    H, W = amostra.shape[:2]
    print(f"celula: {W}x{H}")
    print(f"celulas distintas: {len(por_celula)}")
    for k in sorted(por_celula, key=lambda x: int(x) if str(x).isdigit() else 0)[:5]:
        print(f"  celula {k}: {len(por_celula[k])} recortes")
    print()

    # ---- template = mediana por celula; desvio = dispersao por pixel
    todos_desv, todas_medianas = [], []
    for idx, lista in por_celula.items():
        arr = np.stack([a for _, a in lista])
        med = np.median(arr, axis=0)
        des = arr.std(axis=0).mean(axis=2)          # HxW
        todos_desv.append(des)
        todas_medianas.append(med)
        if int(idx) == 0:
            Image.fromarray(med.astype(np.uint8)).save(
                RAIZ / "dados" / "rotulo" / "moldura-celula0.png"
            )

    des = np.mean(np.stack(todos_desv), axis=0)
    limiar = float(np.percentile(des, 80))
    print(f"desvio por pixel: min {des.min():.2f}  mediana {np.median(des):.2f}  max {des.max():.2f}")
    print(f"limiar 80% = {limiar:.2f}")

    mascara = des >= limiar
    ys, xs = np.where(mascara)
    if len(ys):
        print(f"caixa do sprite: x {xs.min()}..{xs.max()}  y {ys.min()}..{ys.max()}")
        print(f"                {xs.max() - xs.min() + 1}x{ys.max() - ys.min() + 1} de {W}x{H}")
        print(f"area do sprite: {mascara.sum() / mascara.size * 100:.1f}% da celula")
    else:
        print("nenhum pixel acima do limiar")

    # visualizacao: template | mascara | um recorte real
    painel = np.concatenate(
        [
            np.mean(np.stack(todas_medianas), axis=0),
            np.stack([mascara * 255.0] * 3, axis=2),
            por_celula[next(iter(por_celula))][0][1],
        ],
        axis=1,
    ).clip(0, 255)
    Image.fromarray(painel.astype(np.uint8)).save(RAIZ / "dados" / "rotulo" / "moldura-medicao.png")
    print("\n-> H:\\Arcgxapp\\dados\\rotulo\\moldura-medicao.png  (template | mascara | recorte real)")


if __name__ == "__main__":
    main()