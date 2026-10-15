"""
Vizinhos por imagem: para cada recorte, os N itens de catalogo mais parecidos.

## Por que pre-computar

A pergunta da tela de rotulagem e "o que se parece com ESTE recorte?".
Responder no navegador exigiria o modelo em JS e 1.100 embeddings carregados
a cada clique. Pre-computar transforma a busca em ler um array.

## Por que so o vizinho mais proximo nao bastava

A pre-rotulagem automatica erra muito: similaridade mediana 0,63 e so 5,7%
passam de 0,70. Com um unico candidato, errar significa trocar o id errado
por outro errado. Com 15 ordenados, o item certo quase sempre esta na lista
e o acerto custa um clique.

## O limite

Backbone de ImageNet nao conhece icones de jogo. Ele separa texto de foto
melhor do que separa "bateria" de "caixa de municao". A lista e ajuda, nao
verdade, e a confianca vai junto para o usuario ver que ela duvida.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
LOTE = RAIZ / "dados" / "rotulo" / "lote"
SAIDA = RAIZ / "dados" / "rotulo" / "vizinhos.js"

TOP_K = 15


def _carregar_modulo(nome, caminho):
    if str(ML) not in sys.path:
        sys.path.insert(0, str(ML))
    spec = importlib.util.spec_from_file_location(nome, caminho)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod


def principal():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"dispositivo: {device}")

    ## ## O encoder agora e o nosso, nao o ImageNet
    #
    # Antes: `mobilenet_v3_small(weights="DEFAULT")` com a arte crua do
    # catalogo. Isso dava recall@5 de 38% e nenhuma relacao com o app — o
    # worker classifica com o encoder em `ml/modelo/encoder.pt`.
    #
    # Agora a receita vem inteira de `encoder_comum`: encoder treinada, arte
    # enquadrada na celula, recorte com a barra neutralizada. O mesmo modulo
    # e usado pelo treino e pela avaliacao, entao a sugestao da tela de
    # rotulagem mede o mesmo dominio que o modelo em producao.
    ec = _carregar_modulo("encoder_comum", ML / "encoder_comum.py")
    modelo, device = ec.carregar_encoder(device)

    idx = json.loads((LOTE / "capturas.json").read_text(encoding="utf-8"))
    mold = ec.carregar_moldura()

    artes, keep = [], []
    for it in ec.carregar_itens():
        im = ec.arte_framed(it, mold)
        if im is not None:
            artes.append(im)
            keep.append(it)
    print(f"arte: {len(artes)}")

    gal = ec.emb(artes, modelo, device)
    ids = [i["id"] for i in keep]

    recortes, ref = [], []
    for cap in idx["capturas"]:
        for k in range(cap["celulas"]):
            p = LOTE / cap["nome"] / f"{k:02d}.png"
            if p.exists():
                recortes.append(ec.recorte_framed(p, mold))
                ref.append((cap["nome"], k))

    print(f"recortes: {len(recortes)}")
    rec = ec.emb(recortes, modelo, device)

    sim = rec @ gal.T
    top = sim.topk(TOP_K, dim=1)
    vals = top.values.cpu().numpy()
    pos = top.indices.cpu().numpy()

    out = {}
    for (cap, k), linha, vl in zip(ref, pos, vals):
        out.setdefault(cap, {})[f"{k:02d}"] = {
            "itens": [ids[j] for j in linha],
            "notas": [round(float(v), 3) for v in vl],
        }

    SAIDA.write_text(
        "window.VIZINHOS = " + json.dumps(out, ensure_ascii=False) + ";\n", encoding="utf-8"
    )

    print(f"\ntop-1 mediana    : {np.median(vals[:,0]):.3f}")
    print(f"top-1 >= 0.70   : {(vals[:,0] >= 0.70).mean():.1%}")
    print(f"melhor dos 15 >= 0.70: {(vals.max(axis=1) >= 0.70).mean():.1%}")
    print(f"\n-> {SAIDA}")


if __name__ == "__main__":
    principal()