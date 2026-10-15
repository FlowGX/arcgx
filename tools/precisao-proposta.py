"""Precisao da proposta por corte de confianca.

O `propor-rotulos.py` restringe a busca aos 104 itens que o encoder viu
rotulado, porque sobre os outros ~1.000 da galeria ele devolve um vizinho
confiante e errado. Mesmo assim, a primeira medicao deu 94,9% de erro nas
celulas ja rotuladas.

Antes de decidir o que fazer com `propostas.js`, a pergunta e: existe algum
corte de similaridade em que a proposta seja confiavel o bastante para salvar
trabalho? Se nao existe, `propostas.js` sai do fluxo e a tela passa a usar so
`vizinhos.js` — que e uma lista de 15 candidatos, onde errar custa um clique.
Na proposta, errar preenche um rotulo errado.

Precisao e medida **apenas** nas celulas que tem rotulo de verdade. Celula sem
rotulo nao entra: nao ha com o que comparar.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
LOTE = RAIZ / "dados" / "rotulo" / "lote"

sys.path.insert(0, str(ML))
spec = importlib.util.spec_from_file_location("encoder_comum", ML / "encoder_comum.py")
ec = importlib.util.module_from_spec(spec)
sys.modules["encoder_comum"] = ec
spec.loader.exec_module(ec)


def main():
    modelo, device = ec.carregar_encoder()
    mold = ec.carregar_moldura()

    idx = json.loads((LOTE / "capturas.json").read_text(encoding="utf-8"))
    gab = json.loads(ec.GABARITO.read_text(encoding="utf-8"))

    artes, keep = [], []
    for it in ec.carregar_itens():
        im = ec.arte_framed(it, mold)
        if im is not None:
            artes.append(im)
            keep.append(it)
    gal = ec.emb(artes, modelo, device)
    pos_de = {it["id"]: n for n, it in enumerate(keep)}

    # itens que o encoder realmente viu rotulado
    conhecidos = set()
    for celulas in (gab.get("capturas") or {}).values():
        for item in (celulas or {}).values():
            if item and item != "VAZIA":
                conhecidos.add(item)
    poss = sorted(pos_de[i] for i in conhecidos if i in pos_de)
    nomes = [keep[n]["id"] for n in poss]
    sub = gal[poss]
    print(f"galeria {len(gal)} | conhecidos na busca {len(poss)}\n")

    recortes, ref = [], []
    for cap in idx["capturas"]:
        for k in range(cap["celulas"]):
            p = LOTE / cap["nome"] / f"{k:02d}.png"
            if p.exists():
                recortes.append(ec.recorte_framed(p, mold))
                ref.append((cap["nome"], k))
    rec = ec.emb(recortes, modelo, device)

    ## Galeria INTEIRA, sem restricao
    #
    # A restricao aos itens "conhecidos" existia porque o encoder com rotulo
    # so fazia sentido nesses 104. O encoder so de arte cobre os 1.106, e
    # medir na galeria toda e o que interessa: e a cobertura da sugestao que
    # limita a utilidade na tela de rotulagem.
    sub = gal
    nomes = [i["id"] for i in keep]
    print(f"busca na galeria inteira: {len(sub)} itens\n")

    sim = rec @ sub.T
    melhor = sim.argmax(1)
    vals = sim.max(1).values

    # ground truth disponivel
    verdade = []
    for cap, k in ref:
        rot = ((gab.get("capturas") or {}).get(cap) or {}).get(f"{k:02d}")
        verdade.append(rot if rot not in ("VAZIA", "", None) else None)

    tem_verdade = np.array([v is not None for v in verdade])
    acertou = np.array(
        [bool(v) and nomes[melhor[i]] == v for i, v in enumerate(verdade)], dtype=bool
    )
    vv = vals.cpu().numpy()

    print(f"recortes: {len(ref)}   com rotulo: {int(tem_verdade.sum())}")
    print()
    print(f"{'corte':>7} {'cobertura':>12} {'precisao':>12} {'acertos':>9} {'chutes':>8}")
    print("-" * 54)
    for corte in (0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80):
        acima = vv >= corte
        cobertura = int(acima.sum())
        sel = acima & tem_verdade
        n = int(sel.sum())
        if n == 0:
            print(f"{corte:>7.2f} {cobertura:>12} {'sem dado':>12}")
            continue
        ac = int(acertou[sel].sum())
        print(f"{corte:>7.2f} {cobertura:>12} {ac / n:>11.1%} {ac:>9} {n - ac:>8}")

    # teto: entre as celulas JA rotuladas, o que a busca alcanca
    print()
    mask = tem_verdade
    n = int(mask.sum())
    print(f"teto de precisao entre as {n} celulas rotuladas: {acertou[mask].sum() / n:.1%}")
    print("(o modelo so conhece 104 itens; o resto do gabarito ele nunca viu)")


if __name__ == "__main__":
    main()