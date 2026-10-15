"""
Sonda: o encoder e capaz de distinguir item de item?

## Por que este arquivo existe

Trocar 31 negativos por 1.106 subiu o recall@1 de 17,3% para 19,8% e a
similaridade mediana quase nao se moveu (0,248 -> 0,242). Um encoder que
mudou de objetivo **nao** devolve o mesmo numero.

Duas explicacoes, e elas pedem testes diferentes:

1. O modelo collapsed: produz vetores quase constantes. Coisa de modelo
   degenerado. **Sintoma:** similaridade de ~1,0 entre tudo.

2. O modelo nao esta degenerado, mas nao ve o item: produz direcoes quase
   aleatorias porque o sinal util (o objeto) e uma fracao pequena da imagem.
   **Sintoma:** similaridade perto de 0, e um recall@1 alto mesmo numa tarefa
   facil de 10 itens.

O recall@1 de 19,8% contra 1.106 ja separa as duas: 19,8% esta muito acima
de 1/1106 (0,09%), ou seja o encoder **esta** pegando informacao de identidade.
E a similaridade de 0,242 esta longe de 1,0, ou seja **nao** collapsed.

Isso aponta para 3: o encoder funciona, mas fraco demais para 1.106. O que
falta medir e o quanto ele acerta numa tarefa pequena, porque isso separa
"o encoder tem informacao mas precisa de mais dados" de "o encoder nao ve o
item por construcao".

Este script faz a tarefa de 10 itens. Se ele falhar nisso, nenhuma quantidade
de negativos ou de dados vai consertar.

## Por que importa `treinar` e `avaliar`

A primeira versao desta sonda reimplementou o carregamento de imagens e
devolveu "poucos pares: 0" — porque a arte nao esta em
`dados/game/art/<item>.png` e sim no cache `dados/rotulo/cache-arte`, com a
chave `abs(hash(url))`. Reimplementar o caminho e o preprocessamento e o
jeito rapido de medir outra coisa sem querer.

Aqui os modulos sao importados, nao reescritos: se `treinar.py` mudar o
preprocessamento, a sonda mede a coisa nova.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")


def _carregar(nome, caminho):
    spec = importlib.util.spec_from_file_location(nome, caminho)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod


t = _carregar("treinar", RAIZ / "ml" / "treinar.py")
a = _carregar("avaliar", RAIZ / "ml" / "avaliar.py")

N = 10


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    modelo = t.Encoder().to(device)
    modelo.load_state_dict(torch.load(a.PESOS, map_location=device))
    modelo.eval()

    # mesma galeria do avaliar.py
    itens = [
        i
        for i in (json.loads(a.CATALOGO.read_text(encoding="utf-8")).get("items") or {}).values()
        if i.get("imageFilename")
    ]
    # ## A moldura entra dos dois lados
    #
    # A primeira versao media a arte pura do catalogo contra um encoder
    # treinado com arte enquadrada — eunused gave 0/10 na tarefa de 10 itens
    # mesmo com o modelo bom. Medir com o dominio errado produz um numero
    # que parece condemnar o modelo e soesta medindo o loader.
    sys.path.insert(0, str(RAIZ / "ml"))
    import moldura as _mold

    cat = _mold.carregar_catalogo()
    base, _ = _mold.template_base(t.LOTE)
    mold = _mold.Moldura(
        base_arr=np.asarray(base, dtype=np.float32), paleta=_mold.cores_raridade(cat, t.LOTE)
    )

    galeria, idx_de = [], {}
    for it in itens:
        arte = _mold.arte_rgba(it)
        if arte is None:
            continue
        if it.get("rarity") in mold.paleta:
            arte = mold.enquadrar_arte(arte, mold.paleta[it["rarity"]])
        else:
            arte = arte.convert("RGB")
        idx_de[it["id"]] = len(galeria)
        galeria.append(arte.resize((a.LADO, a.LADO), Image.BILINEAR))

    # ate N itens distintos que tenham recorte rotulado E arte
    gab = json.loads(a.GABARITO.read_text(encoding="utf-8"))
    escolhidos = []
    vistos = set()
    for cap, celulas in (gab.get("capturas") or {}).items():
        for idx, item in (celulas or {}).items():
            if not item or item == "VAZIA" or item in vistos:
                continue
            p = t.LOTE / cap / f"{idx}.png"
            if p.exists() and item in idx_de:
                escolhidos.append((p, item))
                vistos.add(item)
        if len(escolhidos) >= N:
            break

    if len(escolhidos) < 3:
        print(f"poucos pares: {len(escolhidos)}")
        return

    escolhidos = escolhidos[:N]
    nomes = [i for _, i in escolhidos]
    print(f"itens na sonda: {len(escolhidos)}")
    print(f"itens: {', '.join(nomes)}\n")

    crops = [
        mold.enquadrar_recorte(Image.open(p).convert("RGB")).resize(
            (a.LADO, a.LADO), Image.BILINEAR
        )
        for p, _ in escolhidos
    ]
    artes = [galeria[idx_de[i]] for i in nomes]

    ec = a.emb(crops, modelo, device)
    ea = a.emb(artes, modelo, device)

    bruto = torch.cat([a.NORMALIZA(im).unsqueeze(0) for im in crops]).to(device)
    with torch.no_grad():
        saida = modelo(bruto)
    print(f"dim do embedding: {saida.shape[1]}")
    print(f"norma media antes de normalizar: {saida.norm(dim=1).mean():.3f}")
    print(f"desvio por dim (colapso => ~0): {saida.std(dim=0).mean():.4f}")

    par = (ec * ea).sum(1).cpu().numpy()
    M = (ec @ ea.T).cpu().numpy()
    fora = np.array([M[i, j] for i in range(len(nomes)) for j in range(len(nomes)) if i != j])

    print()
    print(f"coseno par correto : mediana {np.median(par):.3f}  min {par.min():.3f}  max {par.max():.3f}")
    print(f"coseno par ERRADO  : mediana {np.median(fora):.3f}  max {fora.max():.3f}")
    print(f"separacao          : {np.median(par) - np.median(fora):.3f}")

    rank = M.argmax(1)
    acertos = int((rank == np.arange(len(nomes))).sum())
    print()
    print(f"tarefa {len(nomes)}-way  recall@1: {acertos}/{len(nomes)} = {acertos / len(nomes) * 100:.1f}%")
    for i, nome in enumerate(nomes):
        marca = "ok " if rank[i] == i else "ERR"
        print(f"  {marca} {nome:<22} -> previu {nomes[rank[i]]:<22} cos {M[i, rank[i]]:.3f} (certo {M[i, i]:.3f})")

    # quanta similaridade existe entre crops DIFERENTES: se for alta, o
    # encoder esta lendo a moldura (celula escura, barra de quantidade) e nao
    # o objeto — e o item ocupa so uma fracao da imagem
    C = (ec @ ec.T).cpu().numpy()
    off = np.array([C[i, j] for i in range(len(nomes)) for j in range(len(nomes)) if i != j])
    print()
    print(f"coseno entre crops DISTINTOS : mediana {np.median(off):.3f}  max {off.max():.3f}")
    print("  (se alto, a moldura domina o embedding)")


if __name__ == "__main__":
    main()