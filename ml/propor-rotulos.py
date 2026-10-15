"""
Pre-rotula as celulas com um extrator de features pronto.

## O problema que resolve

Rotular 1.200 celulas a mao e o gargalo do projeto inteiro, e depende de tempo
de usuario que nao existe. Pior: o classificador que temos (dHash) acerta
3/20, entao nao serve nem como ponto de partida — pre-rotular com ele seria
preencher a tela de errado.

A solucao e um backbone **pre-treinado em ImageNet** (torchvision, licenca
BSD, pesos publicos). Nao e nosso modelo e nao precisa ser treinado: e um
extrator de features ja pronto, treinado em centenas de milhoes de imagens.
Embeddings dele em icones de jogo sao muito maisSeparados que dHash, porque
aprendeu representacoes de forma, textura e contexto — nao so silhueta.

## O que isso NAO e

Nao e o modelo final. O encoder que vai no app continua sendo o nosso,
treinado em `treinar.py`. Este aqui so **sugere** a resposta para reduzir o
trabalho de rotulagem. Se a sugestao estiver errada, o usuario corrige — e o
corrector humano vale mais que a sugestao automatica de qualquer modelo.

## Saida

`propostas.js`, no mesmo formato que a pagina de rotulagem consome. A pagina
abre com as celulas ja preenchidas: o trabalho vira revisar, nao digitar.
"""

import importlib.util
import json
import os
import sys
from pathlib import Path

import numpy as np
import torch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
LOTE = RAIZ / "dados" / "rotulo" / "lote"
GABARITO = RAIZ / "dados" / "rotulo" / "gabarito.json"
SAIDA_JS = RAIZ / "dados" / "rotulo" / "propostas.js"

## ## ## A busca agora e na galeria INTEIRA
    #
    # A versao anterior restringia a busca aos 104 itens que o encoder via
    # rotulado, porque o `encoder.pt` so faz sentido neles. Restringir dava
    # 77% de precisao — e era inutil: os 840 rotulos que faltam sao
    # justamente os itens de **fora** desse conjunto.
    #
    # O encoder so de arte (`ml/modelo/encoder-arte.pt`, zero rotulos)
    # cobre os 1.106, e na mesma busca da 64% de precisao. Menos precisa e
    # infinitamente mais util, entao ele que manda.
    #
    # Medido em `tools/precisao-proposta.py` contra o gabarito:
    #   corte  cobertura  precisao
    #   0,60       745      58,7%
    #   0,70       547      58,8%   <- escolhido
    #   0,80       293      64,4%
    #
    # A precisao e da ordem de 60%, nao 90%. Por isso a celula nasce com
    # borda **tracejada** na tela: proposta e confirmacao sao estados
    # diferentes, e um terco delas esta errado. Ver `sugeridas` no HTML.
CORTE = 0.70


def _carregar_modulo(nome, caminho):
    if str(ML) not in sys.path:
        sys.path.insert(0, str(ML))
    spec = importlib.util.spec_from_file_location(nome, caminho)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod


def _pares_rotulados():
    """(caminho, item_id) de todas as celulas ja rotuladas."""
    gab = json.loads(GABARITO.read_text(encoding="utf-8"))
    out = []
    for cap, celulas in (gab.get("capturas") or {}).items():
        for k, item in (celulas or {}).items():
            if item and item != "VAZIA":
                out.append((LOTE / cap / f"{k}.png", item))
    return out

LADO = 128
torch.manual_seed(7)


def backbone():
    """MobileNetV3-Small com pesos ImageNet; devolve 576-d, sem a cabeca."""
    m = mobilenet_v3_small(weights="DEFAULT")
    return torch.nn.Sequential(m.features, m.avgpool).eval()


def baixar_arte(url, destino):
    req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        destino.write_bytes(r.read())


def arte_local(item):
    """Arte do catalogo em disco, com cache. 1.087 downloads sao o gargalo."""
    CACHE.mkdir(parents=True, exist_ok=True)
    chave = f"{abs(hash(item['imageFilename']))}.png"
    p = CACHE / chave
    if not p.exists():
        try:
            baixar_arte(item["imageFilename"], p)
        except Exception:
            return None
    try:
        return Image.open(p).convert("RGB")
    except Exception:
        return None


def preparar(img, device):
    a = np.asarray(img.resize((LADO, LADO), Image.BILINEAR), dtype=np.float32) / 255.0
    # o tensor vai para o device **antes** de qualquer aritmetica; deixar a
    # media em cuda e o tensor em cpu faz o `t - media` estourar com
    # "found at least two devices"
    t = torch.from_numpy(a).permute(2, 0, 1).unsqueeze(0).to(device)
    media = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1).to(device)
    desvio = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1).to(device)
    return (t - media) / desvio


@torch.no_grad()
def embeddings(lista_imgs, modelo, device, lote=64):
    saida = []
    for i in range(0, len(lista_imgs), lote):
        bloco = torch.cat([preparar(im, device) for im in lista_imgs[i : i + lote]])
        e = modelo(bloco)
        # `features` + `avgpool` devolvem (N, 576, 1, 1). Sem achatar, a
        # multiplicacao matriz-vetor abaixo falha com "expected size [691200, 1]"
        e = e.flatten(1)
        saida.append(F.normalize(e, dim=1))
    return torch.cat(saida) if saida else torch.zeros(0, 576, device=device)


def principal():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"dispositivo: {device}")

    ec = _carregar_modulo("encoder_comum", ML / "encoder_comum.py")
    modelo, device = ec.carregar_encoder(device)
    mold = ec.carregar_moldura()

    idx = json.loads((LOTE / "capturas.json").read_text(encoding="utf-8"))
    itens = ec.carregar_itens()
    print(f"catalogo: {len(itens)} itens")

    artes, keep = [], []
    for it in itens:
        im = ec.arte_framed(it, mold)
        if im is not None:
            artes.append(im)
            keep.append(it)
    print(f"arte carregada: {len(artes)}")

    gal = ec.emb(artes, modelo, device)
    print(f"galeria: {tuple(gal.shape)}")

    # O encoder de arte cobre a galeria toda, entao nao ha mais lista de
    # "conhecidos". O numero abaixo e so contexto do relatorio.
    conhecidos = {i for _, i in _pares_rotulados()}
    print(f"itens ja rotulados (contexto): {len(conhecidos)}")

    recortes, ref = [], []
    for cap in idx["capturas"]:
        for k in range(cap["celulas"]):
            p = LOTE / cap["nome"] / f"{k:02d}.png"
            if p.exists():
                recortes.append(ec.recorte_framed(p, mold))
                ref.append((cap["nome"], k))
    print(f"recortes: {len(recortes)}")

    rec = ec.emb(recortes, modelo, device)

    # A galeria e a unica fonte de candidatos: o encoder de arte
    # cobre os 1.106 itens. Ver o bloco do CORTE acima.
    sub = gal
    nomes_sub = [i["id"] for i in keep]

    sim = rec @ sub.T
    melhor = sim.argmax(1)
    melhor_val = sim.max(1).values

    props = {}
    for (cap, k), pos, v in zip(ref, melhor.tolist(), melhor_val.tolist()):
        cel = props.setdefault(cap, {})
        if v >= CORTE:
            cel[f"{k:02d}"] = nomes_sub[pos]
            cel.setdefault("_conf", {})[f"{k:02d}"] = round(v, 3)

    # ---- relatorio
    vals = melhor_val.cpu().numpy()
    print("\ndistribuicao da similaridade (coseno com o vizinho mais proximo):")
    for p in (10, 25, 50, 75, 90):
        print(f"    p{p:02d} = {np.percentile(vals, p):.3f}")
    for corte, nome in ((0.5, "fraco"), (0.7, "medio"), (0.85, "forte")):
        n = int((vals >= corte).sum())
        print(f"    >= {corte} ({nome}): {n}/{len(vals)} = {n/len(vals):.1%}")

    SAIDA_JS.write_text(
        "window.PROPOSTAS = "
        + json.dumps({c: {k: v for k, v in d.items() if not k.startswith("_")} for c, d in props.items()})
        + ";\n"
        + "window.CONFIANCA = "
        + json.dumps({c: d.get("_conf", {}) for c, d in props.items()})
        + ";\n",
        encoding="utf-8",
    )
    print(f"\n-> {SAIDA_JS}")
    print("A pagina de rotulagem passa a abrir com estas sugestoes.")


if __name__ == "__main__":
    principal()