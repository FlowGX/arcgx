"""
Carregamento compartilhado do encoder — galeria, moldura e embedding.

## Por que este modulo existe

Nesta sessao o mesmo bug apareceu **tres vezes**, sempre na mesma forma:
cada script tinha a sua copia do "como carregar a arte" e da "como
normalizar", e as copias divergiram.

1. `avaliar.py` montava a galeria com `avaliar._arte` (arte pura, sem
   moldura) enquanto `treinar.py` treinava com arte enquadrada. Resultado:
   recall@1 de 0,3% — nao era regressao do modelo, era o medidor olhando
   para o dominio errado.
2. `_precarregar_arte` usava `abs(hash(url))` como chave de cache e
   `avaliar._arte` usava md5. `hash()` do Python e randomizado por
   processo, entao o cache nunca batia entre execucoes e o treino baixava
   1.106 PNGs toda vez.
3. `probe-encoder.py` alimentava recorte de 92x104 num modelo de 112x112,
   porque o `NORMALIZA` so faz `ToTensor` + `Normalize` e **nao** redimensiona.
   O MobileNet e convolucional e aceitou a entrada assim mesmo, devolvendo
   embedding de lixo em vez de erro. A sonda acusou 0/10 num modelo que a
   avaliacao honesta dava 38%.

Nenhum dos tres acusou o modelo. Todos acusaram o loader.

A regra que daqui em diante: **quem carrega imagem e este modulo**. Treino,
avaliacao, vizinhos, propostas e sonda usam a mesma receita, entao nao ha
como elas medirem dominios diferentes sem que o codigo mude.

## A receita

- arte do catalogo: RGBA do cache md5, **enquadrada** na celula (`moldura`)
- recorte do jogo: RGB, com a barra inferior neutralizada (`moldura`)
- ambos: redimensionados a `LADO` e normalizados com ImageNet stats
- embedding: `Encoder` treinada em `ml/modelo/encoder.pt`, L2-normalizado
"""

import hashlib
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import torchvision.transforms as T
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
LOTE = RAIZ / "dados" / "rotulo" / "lote"
CATALOGO = RAIZ / "dados" / "game" / "items.json"
GABARITO = RAIZ / "dados" / "rotulo" / "gabarito.json"
CACHE_ART = RAIZ / "dados" / "rotulo" / "cache-arte"
PESOS = RAIZ / "ml" / "modelo" / "encoder.pt"

LADO = int(os.environ.get("ENCODER_SIDE", "224"))
DIM = 256

# ## Por que 224, e nao os 112 que a gente usava
#
# O `scan-worker.js` do ARC Tracker constroi a entrada assim:
#
#     p = e.subarray(l * 150528, ...)     // 150528 = 224 * 224 * 3
#     new Ao.Tensor("float32", p, [u, 224, 224, 3])   // NHWC
#     run({ image: ... }).embedding
#
# Nosso encoder usava 112x112 NCHW: **4x menos pixels** e layout invertido.
# Resolucao e o teto de acuracia — nenhuma augmentation compensa por falta
# de pixels.
#
# O preco e latencia: area cresce 4x, entao 1,33 ms por recorte vira ~5,3 ms
# e uma grade de 20 celulas deixa de caber no orcamento. Por isso `ENCODER_SIDE`
# e variavel — da para treinar a 224 e medir a 112 sem reescrever nada, e
# depois decidir entre fine-tune, quantizacao int8 ou distill.
#
# ## ## NHWC vs NCHW
#
# Eles usam NHWC (canais por ultimo), que e o layout natural de `Tensor` do
# onnxruntime-node. Nosso `.pt` e do PyTorch, que e NCHW. Exportar para
# onnx com `dynamo=False` respeita o `forward`; mudar isso e mexer em
# `permute`, nao no modelo — so se faz se a medicao pedir.

NORMALIZA = T.Compose(
    [
        T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)

# `NORMALIZA` nao redimensiona, e `ToTensor` tambem nao. Todo recorte que
# entra no encoder precisa ser redimensionado antes, senao o MobileNet aceita
# a entrada errada em silencio — ele e convolucional e termina em adaptive
# pool, entao qualquer altura/largura passa. Foi assim que a sonda alimentou
# 92x104 num modelo de 112x112 e devolveu embedding de lixo sem erro.
def preparar(img):
    return NORMALIZA(img.convert("RGB").resize((LADO, LADO), Image.BILINEAR))


def _carregar_modulo(nome, caminho):
    import importlib.util

    if str(ML) not in sys.path:
        sys.path.insert(0, str(ML))
    spec = importlib.util.spec_from_file_location(nome, caminho)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod


def caminho_pesos():
    """
    Qual encoder esta em uso.

    ## Dois encoders, e por que isso precisa ser explicito

    - `encoder.pt` — treinado com os 324 pares rotulados. Cobre bem os itens
      que ja foram rotulados, e **so** eles. Avaliado nos proprios dados de
      treino da 38% de top-1, o que revela overfit, nao capacidade.
    - `encoder-arte.pt` — treinado **sem nenhum rotulo**, so com arte do
      catalogo + augmentation. Nos mesmos 324 recortes da 50,3% de top-1, e
      ele nunca viu nenhum deles.

    Como o de arte cobre os 1.106 itens e nao so os 104 rotulados, ele e o
    melhor para a lista de vizinhos da tela de rotulagem. `ENCODER` no
    ambiente escolhe; sem ela, vale o `encoder.pt` (o que o worker usa).
    """
    import os

    alt = os.environ.get("ENCODER")
    return Path(alt) if alt else PESOS


def carregar_encoder(device=None):
    """`Encoder` do arquivo ativo, em modo de inferencia."""
    import treinar as t

    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    modelo = t.Encoder().to(device)
    modelo.load_state_dict(torch.load(caminho_pesos(), map_location=device))
    modelo.eval()
    return modelo, device


def arte_rgba(item):
    """Arte do catalogo em RGBA, do cache md5 (estavel entre processos)."""
    url = item["imageFilename"]
    p = CACHE_ART / f"{hashlib.md5(url.encode()).hexdigest()}.png"
    if not p.exists():
        try:
            CACHE_ART.mkdir(parents=True, exist_ok=True)
            req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
            with urllib.request.urlopen(req, timeout=20) as r:
                p.write_bytes(r.read())
        except Exception:
            return None
    try:
        return Image.open(p).convert("RGBA")
    except Exception:
        return None


def carregar_moldura():
    """Fundo, paleta de raridade e os dois lados do enquadramento."""
    import moldura as m

    mold, avisos = m.carregar_paleta()
    mold.avisos = avisos
    if avisos:
        print("paleta de raridade com ressalvas:")
        for a in avisos:
            print(f"  ! {a}")
    return mold


def arte_framed(item, mold):
    """Arte do catalogo ja dentro da celula, no tamanho da entrada."""
    img = arte_rgba(item)
    if img is None:
        return None
    if item.get("rarity") in mold.paleta:
        img = mold.enquadrar_arte(img, mold.paleta[item["rarity"]])
    else:
        img = img.convert("RGB")
    return img.resize((LADO, LADO), Image.BILINEAR)


def recorte_framed(caminho, mold):
    """Recorte do jogo com a barra neutralizada, no tamanho da entrada."""
    im = mold.enquadrar_recorte(Image.open(caminho).convert("RGB"))
    return im.resize((LADO, LADO), Image.BILINEAR)


@torch.no_grad()
def emb(imagens, modelo, device, lote=64):
    """Embeddings L2-normalizados. `imagens` ja em `LADO` (use `preparar`)."""
    if not imagens:
        return torch.zeros(0, DIM, device=device)
    saida = []
    for i in range(0, len(imagens), lote):
        bloco = torch.stack([NORMALIZA(im) for im in imagens[i : i + lote]]).to(device)
        saida.append(F.normalize(modelo(bloco), dim=1))
    return torch.cat(saida)


def carregar_itens():
    """Itens do catalogo que tem imagem, em ordem estavel."""
    d = json_catalogo()
    return [i for i in (d.get("items") or {}).values() if i.get("imageFilename")]


def json_catalogo():
    import json

    return json.loads(CATALOGO.read_text(encoding="utf-8"))