"""
Treina um encoder **sem nenhum rotulo**, so com arte do catalogo + augmentation.

## A pergunta que este script responde

"Tem como treinar sozinho, a partir das imagens com nome dos itens?"

A resposta curta: so, com uma condicao. O problema com 1.106 imagens e 1.106
nomes e que cada par e unico — nao ha nada a diferenciar, e o modelo decora
"esses pixels = o nome X" em vez de aprender "isto e uma pistola". Um espaco
de embedding que e so renomeacao arbitraria das 1.106 artes **nao transfere**
para recorte de inventario, que nunca viu.

A condicao e **augmentation**: gerar varias vistas da mesma arte. A partir
disso cada item tem N imagens, o treino contrastivo vira aprendizado real de
invariancia, e o que o modelo captura e a forma.

## A augmentation que importa

Nao e rotacao e brilho generico. E a **composicao dentro da celula**.

O recorte real tem a arte em algum lugar de uma celula 92x104, com uma posicao
e uma escala que variam. Se o treino so enxerga arte centralizada e limpa,
ele nunca casa com o recorte. Entao cada vista aqui coloca a arte na celula
com posicao, escala, rotacao e cor sorteadas — e a com mudanca de fundo.

E a mesma moldura usada no `treinar.py` com rotulo. Nao e coincidencia: e o
mesmo dominio, so que aqui nenhuma vez o modelo viu um recorte real.

## O que este script NAO faz

Nao substitui rotular. Isto aqui e uma **base**: um encoder que funciona em
1.106 itens em vez dos 104 que o modelo com rotulo conhece. Serve para as
sugestoes da tela de rotulagem antes de voce rotular, e como ponto de partida
para um fine-tune depois.

O script mede o resultado honestamente e compara com o encoder que ja existe.
Se ficar pior, o numero esta ai e a decisao e sua.

## Saida

`ml/modelo/encoder-arte.pt` e `encoder-arte.onnx`. **Nunca** toca em
`encoder.pt`, que e o modelo com rotulo e o unico em uso hoje.
"""

import json
import random
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageEnhance
from torch.utils.data import DataLoader, Dataset

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
sys.path.insert(0, str(ML))

import moldura as M  # noqa: E402
import treinar as T  # noqa: E402
from encoder_comum import (  # noqa: E402
    LADO,
    NORMALIZA,
    PESOS,
    carregar_itens,
    carregar_moldura,
)

TEMPERATURA = 0.07
LOTE = 192
EPOCAS_PADRAO = 30

SAIDA_PT = RAIZ / "ml" / "modelo" / "encoder-arte.pt"
SAIDA_ONNX = RAIZ / "ml" / "modelo" / "encoder-arte.onnx"

ITEM_X0, ITEM_X1 = M.ITEM_X0, M.ITEM_X1
ITEM_Y0, ITEM_Y1 = M.ITEM_Y0, M.ITEM_Y1
CELULA_W, CELULA_H = M.CELULA_W, M.CELULA_H


def vista(arte_rgba, base_arr, paleta_cor, rng):
    """
    Uma vista aleatoria da arte, composta dentro da celula.

    ## O que cada sorteio faz

    - **escala** 0,45..1,00 da caixa do item: no jogo o sprite ocupa
      variacoes reais de tamanho, e fixar 1,0 teacharia posicao E escala
      como se fossem o identidade do item.
    - **posicao** dentro da area do item: no recorte real o sprite nao esta
      sempre centrado.
    - **rotacao** ate 12 graus, **brilho/contraste/saturacao** ate 25%.
    - **fundo**: metade das vezes a moldura real, metade um escuro chapado.
      Isso obriga o modelo a nao depender do fundo da celula — que e o que
      fazia ele ler a moldura em vez do objeto.
    """
    caixa_w = ITEM_X1 - ITEM_X0
    caixa_h = ITEM_Y1 - ITEM_Y0
    escala = rng.uniform(0.45, 1.0)
    novo = (max(4, int(caixa_w * escala)), max(4, int(caixa_h * escala)))

    im = arte_rgba.convert("RGBA").resize(novo, Image.LANCZOS)
    if rng.random() < 0.5:
        im = im.rotate(rng.uniform(-12, 12), resample=Image.BICUBIC, expand=False)
    if rng.random() < 0.6:
        im = ImageEnhance.Brightness(im).enhance(rng.uniform(0.8, 1.2))
        im = ImageEnhance.Contrast(im).enhance(rng.uniform(0.8, 1.2))
        im = ImageEnhance.Color(im).enhance(rng.uniform(0.7, 1.3))

    fundo = (
        base_arr.copy()
        if rng.random() < 0.5
        else np.full_like(base_arr, rng.choice([16, 24, 30]))
    )
    fundo = M._desenhar_cunha(fundo, paleta_cor)
    fundo = M._barra_neutra(fundo)
    canvas = Image.fromarray(fundo.astype(np.uint8)).convert("RGBA")

    dx = rng.randint(ITEM_X0, max(ITEM_X0, ITEM_X1 - novo[0]))
    dy = rng.randint(ITEM_Y0, max(ITEM_Y0, ITEM_Y1 - novo[1]))
    canvas.paste(im, (dx, dy), im)
    return canvas.convert("RGB").resize((LADO, LADO), Image.BILINEAR)


class DuasVistas(Dataset):
    """Duas vistas do mesmo item — o par positivo do InfoNCE."""

    def __init__(self, itens, mold, arte_por_id, semeio=0):
        self.itens = itens
        self.mold = mold
        self.arte = arte_por_id
        self.semeio = semeio

    def __len__(self):
        return len(self.itens)

    def __getitem__(self, i):
        it = self.itens[i]
        arte = self.arte[i]
        if arte is None:
            # arte que falhou no download: um preto. aparece como um item so
            # "ruim", que e melhor que arrancar a linha e desalinhar o indice
            vazio = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        else:
            vazio = arte
        rng = random.Random(f"{self.semeio}-{i}-{random.random()}")
        cor = self.mold.paleta.get(it.get("rarity"), (24, 28, 44))
        a = vista(vazio, self.mold.base_arr, cor, rng)
        b = vista(vazio, self.mold.base_arr, cor, rng)
        # o indice vai junto: e o alvo do InfoNCE. Sem ele o laco teria que
        # reconstruir o mapeamento a partir do item, e foi exatamente assim que
        # o alvo do `treinar.py` saiu errado.
        return i, NORMALIZA(a), NORMALIZA(b)


def carregar_artes():
    mold = carregar_moldura()
    itens = carregar_itens()
    arte = []
    for it in itens:
        im = M.arte_rgba(it)
        if im is not None:
            arte.append(im)
        else:
            arte.append(None)
    # mantem apenas os que tem arte, para nao treinar em vazio
    manter = [i for i, a in enumerate(arte) if a is not None]
    itens = [itens[i] for i in manter]
    arte = [arte[i] for i in manter]
    return mold, itens, arte


def aquecer_banco(modelo, ds, n, dim, device):
    """
    Codifica a galeria inteira **antes** do treino e joga no banco.

    ## Por que antes, e nao durante

    Na versao com rotulo (`treinar.py`) a fila comeca vazia e o alvo muda de
    significado quando ela enche: ate la a negativa e o lote e o alvo e a
    linha; depois a negativa e a galeria e o alvo e o indice do catalogo.
    Trocar de regime no meio do treino foi justamente o que produziu um
    treino que "subia" e nao aprendia nada.

    Aqui nao existe esse regime: o indice do item **e** a posicao no banco,
    porque o lote e sorteado por indice. Aquece com uma passada e pronto —
    o alvo e o mesmo desde o primeiro passo.

    ## Uma vista por item, nao duas

    O banco precisa de um embedding por item, nao um por vista. Codificar as
    duas vistas do mesmo item escreveria duas linhas na mesma posicao, e a
    segunda sobrescreveria a primeira — a segunda vista do lote inteiro
    defines a galeria. Aqui so a vista A entra.
    """
    modelo.eval()
    banco = torch.zeros(n, dim, device=device)
    with torch.no_grad():
        for i in range(0, n, 128):
            bloco = torch.stack([ds[j][1] for j in range(i, min(i + 128, n))]).to(device)
            banco[i : i + bloco.shape[0]] = modelo(bloco)
    modelo.train()
    return F.normalize(banco, dim=1)


def construir(device):
    """
    Encoder com o tronco em ImageNet, nao aleatorio.

    ## Por que isso aqui e nao no `treinar.py`

    `Encoder()` de `treinar.py` usa `mobilenet_v3_small(weights=None)` — peso
    aleatorio. Com 324 pares rotulados isso ate funciona, porque o problema
    (encaixar 104 classes) e pequeno. Aqui sao 1.106 itens e **nenhum** rotulo:
    o primeiro jeito de rodar deu perda 14,28 em 3 epocas, que e exatamente
    2·ln(1106) — os dois InfoNCE em chance, o modelo nao tinha aprendido nada.

    1.106 imagens nao treinam um MobileNet do zero. Partir do ImageNet da
    transferencia de forma/textura, que e o que sobra para aprender com
    augmentacao, e o encoder precisa de muito menos passos.

    O tronco do `Encoder` e `Sequential(features, avgpool)` — exatamente o
    que os pesos do ImageNet cobrem. Entao em vez de reescrever a arquitetura,
    so se troca o tronco por um com peso.
    """
    from torchvision.models import mobilenet_v3_small

    base = mobilenet_v3_small(weights="DEFAULT")
    modelo = T.Encoder().to(device)
    modelo.tronco = nn.Sequential(base.features, base.avgpool).to(device)
    return modelo


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    epocas = int(__import__("os").environ.get("EPOCAS", EPOCAS_PADRAO))
    print(f"dispositivo: {device}   epocas: {epocas}")

    mold, itens, arte = carregar_artes()
    print(f"itens com arte: {len(itens)}   (sem rotulo nenhum)")

    modelo = construir(device)
    opt = torch.optim.AdamW(modelo.parameters(), lr=3e-4, weight_decay=1e-4)
    dl = DataLoader(
        DuasVistas(itens, mold, arte, semeio=1),
        batch_size=LOTE,
        shuffle=True,
        num_workers=0,
        drop_last=True,
    )

    print("aquecendo banco com a galeria...")
    banco = aquecer_banco(modelo, dl.dataset, len(itens), T.DIM, device)
    print(f"banco: {tuple(banco.shape)}")

    indice_de = {it["id"]: n for n, it in enumerate(itens)}
    print(f"\n{'ep':>4} {'perda':>9} {'top-1 treino':>13}")
    print("-" * 30)
    for ep in range(epocas):
        modelo.train()
        tot = acertos = 0
        perda_ep = 0.0
        for idxs, a, b in dl:
            idxs = torch.tensor([indice_de[itens[j]["id"]] for j in idxs.tolist()], device=device)
            a, b = a.to(device), b.to(device)

            ea, eb = modelo(a), modelo(b)

            # simetrico: as duas direcoes, para o gradiente nao depender so
            # da vista A puxar a B
            la = ea @ banco.T / TEMPERATURA
            lb = eb @ banco.T / TEMPERATURA
            perda = F.cross_entropy(la, idxs) + F.cross_entropy(lb, idxs)
            # arrasto direto do par positivo, independente do banco
            perda = perda + (1.0 - (ea * eb).sum(1)).mean()

            opt.zero_grad()
            perda.backward()
            opt.step()

            tot += len(a)
            acertos += int((la.argmax(1) == idxs).sum()) + int((lb.argmax(1) == idxs).sum())
            perda_ep += perda.item() * len(a)
        print(f"{ep + 1:>4} {perda_ep / tot:>9.4f} {acertos / (tot * 2):>12.1%}")

    torch.save(modelo.state_dict(), SAIDA_PT)
    torch.onnx.export(
        modelo,
        torch.randn(1, 3, LADO, LADO).to(device),
        str(SAIDA_ONNX),
        input_names=["entrada"],
        output_names=["embedding"],
        dynamic_axes={"entrada": {0: "n"}, "embedding": {0: "n"}},
        opset_version=17,
        dynamo=False,
    )
    print(f"\npesos: {SAIDA_PT}")
    print(f"ONNX : {SAIDA_ONNX}  ({SAIDA_ONNX.stat().st_size / 1e6:.1f} MB)")
    print(f"\n`encoder.pt` NAO foi tocado — o modelo com rotulo segue intacto.")
    print("Para medir: python tools/comparar-encoders.py")


if __name__ == "__main__":
    main()