"""
Compara o encoder **com rotulo** (o de hoje) com o encoder **so de arte**.

## O que esta medindo

O `treinar-arte.py` termina com 59% de top-1 no treino, mas esse numero e
arte contra arte — duas vistas com augmentation do mesmo catalogo. Ele nao
diz nada sobre recorte de inventario, que e o que a tela de captura entrega.

A unica medicao que importa e a mesma do `avaliar.py`: codificar os 1.200
recortes reais, codificar a galeria, e ver onde o item verdadeiro cai na
ordenacao. Roda aqui para os dois modelos lado a lado.

## Para que serve o resultado

Se o encoder so de arte perder feio, ele **nao entra** em lugar nenhum e o
`encoder.pt` segue como esta. Se ele ganhar em cobertura — acertando itens
que o modelo com rotulo nunca viu — vira candidado a entrar na lista de
vizinhos da tela de rotulagem, que e onde ele tem chance de ajudar.

O numero que decide nao e so o recall: e o recall **nos itens que nenhum dos
dois modelos viu rotulado**.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
LOTE_DIR = RAIZ / "dados" / "rotulo" / "lote"

sys.path.insert(0, str(ML))
spec = importlib.util.spec_from_file_location("encoder_comum", ML / "encoder_comum.py")
ec = importlib.util.module_from_spec(spec)
sys.modules["encoder_comum"] = ec
spec.loader.exec_module(ec)

import treinar as T  # noqa: E402


def carregar(pesos, device):
    m = T.Encoder().to(device)
    m.load_state_dict(torch.load(pesos, map_location=device))
    m.eval()
    return m


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    mold = ec.carregar_moldura()

    idx = json.loads((LOTE_DIR / "capturas.json").read_text(encoding="utf-8"))
    gab = json.loads(ec.GABARITO.read_text(encoding="utf-8"))

    artes, ids = [], []
    for it in ec.carregar_itens():
        im = ec.arte_framed(it, mold)
        if im is not None:
            artes.append(im)
            ids.append(it["id"])
    print(f"galeria: {len(artes)}")

    recortes, ref = [], []
    for cap in idx["capturas"]:
        for k in range(cap["celulas"]):
            p = LOTE_DIR / cap["nome"] / f"{k:02d}.png"
            if p.exists():
                recortes.append(ec.recorte_framed(p, mold))
                ref.append((cap["nome"], k))
    print(f"recortes: {len(recortes)}\n")

    pos_de = {i: n for n, i in enumerate(ids)}
    # o que o encoder com rotulo realmente conhece
    conhecidos = set()
    for celulas in (gab.get("capturas") or {}).values():
        for v in (celulas or {}).values():
            if v and v != "VAZIA":
                conhecidos.add(v)

    modelos = {
        "com rotulo (encoder.pt)": ec.PESOS,
        "so de arte (encoder-arte.pt)": RAIZ / "ml" / "modelo" / "encoder-arte.pt",
    }

    for rotulo, caminho in modelos.items():
        if not caminho.exists():
            print(f"{rotulo}: pesos ausentes ({caminho})")
            continue
        modelo = carregar(caminho, device)
        g = ec.emb(artes, modelo, device)
        r = ec.emb(recortes, modelo, device)

        sim = r @ g.T
        ordem = sim.argsort(dim=1, descending=True)
        top5 = ordem[:, :5]

        ranks, vistos = [], []
        for n, (cap, k) in enumerate(ref):
            gt = ((gab.get("capturas") or {}).get(cap) or {}).get(f"{k:02d}")
            if not gt or gt == "VAZIA" or gt not in pos_de:
                continue
            alvo = pos_de[gt]
            onde = int((top5[n] == alvo).nonzero()[0, 0]) + 1 if (top5[n] == alvo).any() else None
            if onde is None:
                pos = int((ordem[n] == alvo).nonzero()[0, 0]) + 1
            else:
                pos = onde
            ranks.append(pos)
            vistos.append(gt in conhecidos)

        ranks = np.array(ranks)
        vistos = np.array(vistos)
        print(f"=== {rotulo} ===")
        print(f"celulas rotuladas avaliadas: {len(ranks)}")
        print(f"  recall@1 : {(ranks == 1).mean():>6.1%}")
        print(f"  recall@5 : {(ranks <= 5).mean():>6.1%}")
        print(f"  recall@15: {(ranks <= 15).mean():>6.1%}")
        print(f"  mediana  : {np.median(ranks):>6.0f}")
        for nome, mask in (("itens QUE o modelo viu rotulado", vistos), ("items que NENHUM viu", ~vistos)):
            if mask.sum():
                print(
                    f"  {nome:<30} n={int(mask.sum()):>3}  "
                    f"@1 {(ranks[mask] == 1).mean():>5.1%}  @5 {(ranks[mask] <= 5).mean():>5.1%}"
                )
        print()
        del modelo, g, r
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()