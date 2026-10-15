"""
Treina o encoder de itens e exporta ONNX.

## A ideia que faz isso funcionar com rótulo parcial

Rotular 1.200 células dá talvez 150 itens distintos — 14% do catálogo. Se
treinássemos um classificador de 150 classes, o modelo aprenderia exatamente
esses 150 e não saberia nada dos outros 937. Pior: o app precisa dos 1.113.

O truque é não treinar classes, treinar **espaço**. O encoder mapeia qualquer
recorte para um vetor; a galeria vira um conjunto de âncoras:

    embed(recorte do jogo)  ≈  embed(arte do catálogo)   para o mesmo item

Só os itens rotulados produzem pares. Mas cada par treina contra **todas** as
1.087 artes como negativo, então o modelo aprende a separar o item certo de
todo o resto do catálogo — inclusive dos que ninguém rotulou.

No app viaja **um modelo só** (o encoder, ~5 MB). A galeria é dado, não peso,
e pode crescer para 2.000 itens sem trocar nada.

## Por que isso e não triplet direto

Triplet com âncora positiva e negativa sorteada amostra mal em 1.087 classes:
a chance de sortear um negativo confundível é baixa, e o gradiente fica
irregular. InfoNCE contra a galeria inteira usa todas as negativas de uma vez
e é mais estável com poucaGPU livre.
"""

import json
import os
import random
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from torchvision.models import mobilenet_v3_small

RAIZ = Path(r"H:\Arcgxapp")
LOTE = RAIZ / "dados" / "rotulo" / "lote"
GABARITO = RAIZ / "dados" / "rotulo" / "gabarito.json"
CATALOGO = RAIZ / "dados" / "game" / "items.json"
SAIDA = RAIZ / "ml" / "modelo"

LADO = int(os.environ.get("ENCODER_SIDE", "224"))  # entrada do encoder
DIM = 256           # dimensão do embedding
TEMPERATURA = 0.07

torch.manual_seed(7)
random.seed(7)


# ----------------------------------------------------------------- modelo


class Encoder(nn.Module):
    """MobileNetV3-Small sem a cabeça de classificação + projeção 256-d."""

    def __init__(self, dim: int = DIM):
        super().__init__()
        base = mobilenet_v3_small(weights=None)
        # `features` + `avgpool` saem 576-d; a cabeça original (1280 classes)
        # é descartada — classificar 1.113 itens direto não generaliza para
        # itens novos e não é o que queremos
        self.tronco = nn.Sequential(base.features, base.avgpool)
        self.projecao = nn.Sequential(
            nn.Flatten(),
            nn.Linear(576, dim),
            nn.BatchNorm1d(dim),
        )

    def forward(self, x):
        e = self.tronco(x)
        e = self.projecao(e)
        return F.normalize(e, dim=1)


# ----------------------------------------------------------------- dados


class Rotulados(Dataset):
    """Recortes do jogo com a arte do catalogo do MESMO item.

    ## Por que a arte viaja junto

    O `InfoNCE` precisa da positiva presente dentro do lote — o alvo `i`
    so existe se a arte do item do recorte `i` estiver no lote. Sortear o lote
    de ancoras separado quebra isso: o indice global do catalogo nunca coincide
    com a posicao no lote, e o `cross_entropy` pointed para a linha errada.

    ## Onde a arte vem

    Do cache ja usado por `gerar-vizinhos.py` (`dados/rotulo/cache-arte`), que
    tem as 1.106 artes baixadas. Reaproveitar evita baixar 324 vezes e garante
    que treino e rotulagem veem exatamente o mesmo pixel.
    """

    def __init__(self, pares, galeria_por_id, indice_de=None, enquadrar_recorte=None):
        self.pares = pares
        self.galeria = galeria_por_id
        # posicao do item na galeria — o alvo correto do InfoNCE
        self.indice_de = indice_de or {}
        self.enquadrar_recorte = enquadrar_recorte

    def __len__(self):
        return len(self.pares)

    def __getitem__(self, i):
        caminho, item_id = self.pares[i]
        recorte = Image.open(caminho).convert("RGB")

        # ## O recorte tambem entra na moldura
        #
        # Apaga o icone e a quantidade da barra inferior. Sem isso o recorte
        # carrega numero de pilha — pista de classe que a arte enquadrada
        # nao tem, e o encoder aprenderia a ler o numero em vez do item.
        if self.enquadrar_recorte is not None:
            recorte = self.enquadrar_recorte(recorte)

        recorte = recorte.resize((LADO, LADO), Image.BILINEAR)

        arte = self.galeria.get(item_id)
        if arte is None:
            arte = Image.new("RGB", (LADO, LADO), (18, 16, 14))

        # `self.galeria` ja traz **tensor** (precarregado uma vez), e nao
        # imagem. `ToTensor` so aceita PIL/ndarray, entao so o recorte passa
        # pelo transform; a arte ja esta pronta.
        #
        # Devolve o indice da galeria como terceiro elemento: e um `int`, e
        # o collate padrao empilha ints em tensor sem reclamar. O `id` (string)
        # nao volta, porque o collate tentaria empilhar strings.
        return transforms_tensor(recorte), arte, self.indice_de.get(item_id, -1)


def transforms_tensor(img):
    import torchvision.transforms as T

    return T.Compose(
        [
            T.ToTensor(),
            T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )(img)


def carregar_rotulos():
    if not GABARITO.exists():
        raise SystemExit(
            f"gabarito.json nao encontrado em {GABARITO}\n"
            "Roteule em dados/rotulo/rotular-lote.html e baixe o arquivo."
        )
    dados = json.loads(GABARITO.read_text(encoding="utf-8"))
    pares = []
    vazias = 0
    for captura, celulas in (dados.get("capturas") or {}).items():
        for idx, item in (celulas or {}).items():
            if not item:
                continue
            if item == "VAZIA":
                vazias += 1
                continue
            caminho = LOTE / captura / f"{idx}.png"
            if caminho.exists():
                pares.append((caminho, item))
    print(f"recortes rotulados: {len(pares)}  (ignorados como vazios: {vazias})")
    print(f"itens distintos   : {len({i for _, i in pares})}")
    return pares


def dry_run():
    """
    Prova o pipeline inteiro sem rotulo real.

    ## Por que isso existe

    Descobrir que o treino quebra por um erro de caminho, de dimensao ou de
    versao do ONNX *depois* de alguem passar duas horas rotulando e uma noite
    esperando e o modo mais caro de descobrir. O `dry-run` gera rotulo falso,
    roda uma epoca e exporta — os unicos lugares que ele nao prova sao a
    qualidade do modelo e a acuracia, que dependem so do rotulo verdadeiro.

    O numero de acuracia que sai daqui **nao significa nada** e e impresso
    como tal. O que importa e o ONNX aparecer no disco.
    """
    print("=== DRY RUN: rotulo sintetico, 1 epoca ===")
    print("a acuracia impressa aqui e SEM VALOR — so o pipeline esta sendo testado\n")

    idx = json.loads((LOTE / "capturas.json").read_text(encoding="utf-8"))
    itens = [i for i in (json.loads(CATALOGO.read_text(encoding="utf-8")).get("items") or {}).values()
             if i.get("imageFilename")]
    indice = {i["id"]: n for n, i in enumerate(itens)}

    # rotulo sintetico: o id da galeria correspondente a posicao da celula
    pares = []
    for cap in idx["capturas"][:10]:
        for k in range(cap["celulas"]):
            p = LOTE / cap["nome"] / f"{k:02d}.png"
            if p.exists():
                pares.append((p, indice[itens[k % len(itens)]["id"]]))

    print(f"pares sinteticos: {len(pares)}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"dispositivo: {device}")

    modelo = Encoder().to(device)
    # `Rotulados` devolve o valor cru; para o treino ele precisa ser indice
    class _Idx(Rotulados):
        def __getitem__(self, i):
            caminho, _ = self.pares[i]
            img = Image.open(caminho).convert("RGB").resize((LADO, LADO), Image.BILINEAR)
            return transforms_tensor(img), self.pares[i][1]

    dl = DataLoader(_Idx(pares), batch_size=16, shuffle=True, drop_last=True)
    opt = torch.optim.AdamW(modelo.parameters(), lr=3e-4)

    modelo.train()
    for x, y in dl:
        x, y = x.to(device), y.to(device)
        e = modelo(x)
        perda = F.cross_entropy(e, y) * TEMPERATURA
        opt.zero_grad()
        perda.backward()
        opt.step()
    print("uma epoca de treino: ok (gradiente passou)")

    modelo.eval()
    with torch.no_grad():
        y = modelo(torch.randn(2, 3, LADO, LADO, device=device))
    print(f"inferencia: {tuple(y.shape)}, norma {float(y[0].norm()):.4f}")

    exportar(modelo, device)
    print("\n=== DRY RUN OK: o caminho rotulo -> treino -> ONNX funciona ===")
    print("Falta so um gabarito.json de verdade.")


def carregar_galeria():
    dados = json.loads(CATALOGO.read_text(encoding="utf-8"))
    itens = [i for i in (dados.get("items") or {}).values() if i.get("imageFilename")]
    print(f"galeria: {len(itens)} itens com arte")
    return itens


class Galeria(Dataset):
    def __init__(self, itens):
        self.itens = itens

    def __len__(self):
        return len(self.itens)

    def __getitem__(self, i):
        import numpy as np
        import urllib.request

        url = self.itens[i]["imageFilename"]
        cache = Path(os.environ.get("TEMP", ".")) / "arcgx-galeria" / f"{abs(hash(url))}.png"
        if not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    cache.write_bytes(r.read())
            except Exception:
                # **Nao** derruba o treino.
                #
                # Uma arte que dá 404 ou timeout dentro do `__getitem__` estoura
                # a excecao para o chamador e o treinamento morre inteiro —
                # quando bastava perder uma ancora. Pior: a falha so aparece
                # na epoch que alcança aquele item, muito depois de qualquer
                # verificacao inicial, e parece "o treino quebrou sozinho".
                # Uma ancora preta ainda e um negativo valido.
                Image.new("RGB", (LADO, LADO), (18, 16, 14)).save(cache)

        try:
            img = Image.open(cache).convert("RGB").resize((LADO, LADO), Image.BILINEAR)
        except Exception:
            # cache truncado de um download interrompido
            Image.new("RGB", (LADO, LADO), (18, 16, 14)).save(cache)
            img = Image.open(cache).convert("RGB")

        # fundo escuro, como a célula real: a arte vem com fundo transparente
        # ou claro, e o modelo precisa casar com o que vê no jogo
        fundo = Image.new("RGB", (LADO, LADO), (18, 16, 14))
        if img.mode == "RGBA":
            fundo.paste(img, (0, 0), img)
            img = fundo
        return transforms_tensor(img), i


# ------------------------------------------------------------- treino


class FilaMemoria:
    """
    Embeddings do catalogo usados como negativos em TODO passo.

    ## O que resolve

    Na versao anterior o `InfoNCE` media o recorte contra os outros itens do
    **mesmo lote**. Eram 31 negativos. O modelo nunca via os outros 1.074 do
    catalogo, entao aprendia a separar 32 e nunca 1.106 — e o resultado era
    uma representacao colapsada (similaridade 0,25 depois de 40 epocas).

    ## Como mantem o custo baixo

    O catalogo inteiro cabe na memoria da GPU: 1.106 x 256 float32 = 1,1 MB.
    A arte e codificada **uma vez** por epoca, e nao a cada passo. O preco e
    uma passada extra do encoder por epoca, nao 30 por epoca — que e o que
    tornaria "usar a galeria toda como negativa" viavel.

    ## Sobre o Momentum

    O MoCo original tambem usa um encoder de momentum. Aqui nao: nao ha
    augmentacao forte o suficiente para exigir consistencia entre um encoder
    lento e um rapido, e um segundo encoder custaria o dobro de VRAM por um
    ganho que aqui nao se pagaria. A fila e so o **banco de negativos**.
    """

    def __init__(self, n, dim, device):
        self.banco = torch.zeros(n, dim, device=device)
        self.n = n
        self.device = device
        self.cheio = False
        self.ptr = 0

    def encoder(self, modelo, imgs, batch_size=128):
        saida = []
        modelo.eval()
        with torch.no_grad():
            for i in range(0, len(imgs), batch_size):
                bloco = torch.stack([imgs[j] for j in range(i, min(i + batch_size, len(imgs)))]).to(self.device)
                saida.append(F.normalize(modelo(bloco), dim=1))
        modelo.train()
        return torch.cat(saida) if saida else None

    def atualizar(self, emb):
        k = emb.shape[0]
        idx = (torch.arange(k, device=self.device) + self.ptr) % self.n
        self.banco[idx] = emb
        self.ptr = int((self.ptr + k) % self.n)
        self.cheio = self.cheio or self.ptr >= self.n

    def indice_de(self, item_ids, ids_gal):
        mapa = {v: k for k, v in enumerate(ids_gal)}
        return torch.tensor([mapa.get(i, -1) for i in item_ids], device=self.device)


class GaleriaPronta(Dataset):
    """Arte do catalogo ja em tensor — nada de decodificar por epoca."""

    def __init__(self, ids, tensores):
        self.ids = ids
        self.tensores = tensores

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, i):
        return self.tensores[i]


def _precarregar_arte(itens, mold=None):
    """
    Carrega e enquadra a arte de cada item **uma vez**, em memoria.

    ## Por que antes do treino e nao no `__getitem__`

    `Galeria.__getitem__` decodifica um PNG e faz resize a cada chamada. Com
    1.100 itens por epoca, isso e o gargalo — e nao o modelo, que tem 1 milhao
    de parametros. Decodificar 1.100 PNGs custa segundos; carregar 324 pares com
    asNegative de cada epoca custa o mesmo se cada chamada re-faz o trabalho.

    O resultado e so o tensor pronto: `__getitem__` vira um dict lookup, e o
    gargalo de I/O desaparece do loop.
    """
    from PIL import Image as _Image

    out = {}
    por_id = {i["id"]: i for i in itens}
    CACHE_ART = RAIZ / "dados" / "rotulo" / "cache-arte"
    print(f"precarregando arte de {len(itens)} itens…")
    for it in itens:
        url = it.get("imageFilename")
        if not url:
            continue
        # md5 da URL, e nao `abs(hash(url))`: o `hash()` do Python e
        # randomizado por processo, entao a chave mudava a cada execucao e o
        # cache nunca batia — o treino baixava 1.106 PNGs toda vez. E o mesmo
        # que `avaliar._arte` e `moldura.arte_rgba` usam, entao os tres
        # compartilham o mesmo arquivo em disco.
        import hashlib

        p = CACHE_ART / f"{hashlib.md5(url.encode()).hexdigest()}.png"
        if not p.exists():
            # tenta baixar; falha aqui e aceitavel porque o vizinhos ja baixou
            try:
                import urllib.request

                CACHE_ART.mkdir(parents=True, exist_ok=True)
                req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    p.write_bytes(r.read())
            except Exception:
                continue
        try:
            img = _Image.open(p).convert("RGBA")
        except Exception:
            continue

        # ## A arte entra na moldura da celula antes de virar tensor
        #
        # Sem isso o encoder recebe recorte de um dominio (celula escura, cunha
        # de raridade, barra) e arte de outro (sprite solto, fundo
        # transparente). A sonda mostrou o preco: crops de itens diferentes
        # davam coseno 0,398 — maior que o do par certo, 0,286. O modelo lia
        # a moldura, nao o objeto.
        #
        # Enquadrar as duas pontas deixa o objeto como unico delta.
        info = por_id.get(it["id"]) or {}
        raridade = info.get("rarity")
        if mold is not None and raridade in mold.paleta:
            img = mold.enquadrar_arte(img, mold.paleta[raridade], mold.base_arr)
        else:
            img = img.convert("RGB")

        img = img.resize((LADO, LADO), _Image.BILINEAR)
        out[it["id"]] = transforms_tensor(img)
    print(f"arte carregada: {len(out)} itens")
    return out


def main():
    pares = carregar_rotulos()
    itens = carregar_galeria()

    # ## O recorte e a arte sao o mesmo item
    #
    # O `Rotulados` agora traz a arte do catalogo junto com o recorte, para
    # o `InfoNCE` ter a positiva dentro do proprio lote. O indice global do
    # catalogo deixa de ser necessario aqui — so precisamos do `id` para achar
    # a arte.
    #
    # E a arte vem do cache que o `gerar-vizinhos.py` ja preencheu, com
    # decode+resize feitos **uma vez** aqui. Refeito a cada `__getitem__`, o
    # decode de 1.100 PNGs por epoca dominaria o tempo de treino.
    # ## A moldura precisa existir antes de qualquer arte virar tensor
    #
    # `moldura` monta o fundo, a barra neutra e a paleta de raridade, e e
    # usada dos dois lados: enquadra a arte do catalogo e limpa a barra do
    # recorte real. Sem ela, as duas pontas vivem em dominios diferentes.
    mold = None
    try:
        import moldura as _mold

        _cat = _mold.carregar_catalogo()
        _base, _ = _mold.template_base(LOTE)
        _paleta = _mold.cores_raridade(_cat, LOTE)
        mold = _mold.Moldura(
            base_arr=np.asarray(_base, dtype=np.float32), paleta=_paleta
        )
        print(f"moldura: paleta de {len(_paleta)} raridades")
    except Exception as e:
        print(f"aviso: sem moldura ({e}); treino com arte pura")

    galeria_por_id = _precarregar_arte(itens, mold=mold)
    # so os itens com arte carregada servem de ancora **e** de negativo
    ids = [i["id"] for i in itens if i["id"] in galeria_por_id]

    pares = [(p, i) for p, i in pares if i in galeria_por_id]
    if not pares:
        raise SystemExit("nenhum rotulo casa com a galeria")
    print(f"pares utilizaveis: {len(pares)}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"dispositivo: {device}")

    modelo = Encoder().to(device)
    opt = torch.optim.AdamW(modelo.parameters(), lr=3e-4, weight_decay=1e-4)

    ids_gal = [i for i in ids if i in galeria_por_id]
    indice_de = {item: n for n, item in enumerate(ids_gal)}

    dl_rot = DataLoader(
        Rotulados(
            pares,
            galeria_por_id,
            indice_de=indice_de,
            enquadrar_recorte=mold.enquadrar_recorte if mold else None,
        ),
        batch_size=32,
        shuffle=True,
        num_workers=0,
        drop_last=True,
    )

    # ## Fila de memória: o que faltava da primeira versão
    #
    # O `InfoNCE` original media o recorte contra os **outros itens do mesmo
    # lote** — 31 negativos. O modelo nunca era treinado contra os outros
    # 1.074 do catálogo, então ele aprendia a separar 32 e nunca 1.106.
    #
    # A fila guarda os embeddings da galeria inteira: 1.106 × 256 float32
    # = 1,1 MB, cabe folgado na VRAM. A arte e codificada uma vez por época,
    # e nao a cada passo — esse preco e o que torna viavel usar a galeria
    # toda como negativa.
    print(f"galeria para negativa: {len(ids_gal)} itens")

    dl_gal = None
    fila = None
    if len(ids_gal) >= 256:
        fila = FilaMemoria(len(ids_gal), DIM, device)
        dl_gal = DataLoader(
            GaleriaPronta(ids_gal, [galeria_por_id[i] for i in ids_gal]),
            batch_size=128,
            shuffle=True,
        )

    epocas = int(os.environ.get("EPOCAS", 30))
    for ep in range(epocas):
        modelo.train()
        # ## O lote de ancoras vem **dentro** do lote de recorte
        #
        # A primeira versao tentava sortear as duas sequencias na
        # independente e cruzar `e @ g.T`. Isso esta errado por construcao:
        # `y` e o indice **global** do catalogo, e nao a posicao dentro do
        # lote de ancoras — entao `cross_entropy` nunca acha a linha certa,
        # e o tensor ainda estoura com "size of tensor a (32) must match
        # b (64)", porque os dois lotes tem larguras diferentes.
        #
        # Aqui cada recorte traz **a propria arte do seu item** junto. O
        # `cross_entropy` olha so para dentro do lote: a ancora positiva e a
        # linha `i`, e as negativas sao os outros itens *deste* lote. Como a
        # ancora esta presente por construcao, o alvo `i` e sempre correto.
        #
        # As negativas da epoca inteira vem do embaralhamento do `dl_rot`:
        # cada epoca junta rotulos diferentes, entao o conjunto de negativos
        # muda sempre.
        tot, acertos, perda = 0, 0, 0.0

        for x, gx, alvo in dl_rot:
            x, gx, alvo = x.to(device), gx.to(device), alvo.to(device)

            e = modelo(x)      # recorte do jogo
            g = modelo(gx)     # arte do catalogo do MESMO item

            # ## Com fila: a negativa e a galeria inteira
            #
            # `logits[i][j]` compara o recorte `i` com a arte `j` da galeria.
            # `alvo` vem do dataset: e a posicao **na galeria** do item do
            # recorte `i`, nao a posicao da linha no lote.
            #
            # ## O bug que isto corrige
            #
            # Antes era `alvo = torch.arange(len(x))` — a linha do lote. A
            # fila e indexada por posicao no CATALOGO, e o `DataLoader`
            # embaralha, entao a linha `i` apontava para um item sem
            # relacao nenhuma com o recorte `i`. Ou seja: assim que a fila
            # encheu, o `cross_entropy` passou a treinar o modelo em direcao
            # a alvos errados. Era por isso que trocar 31 negativos por 1.106
            # subiu o recall so de 17,3% para 19,8% e a similaridade mediana
            # nao saiu de 0,25 — e por isso que o "top-1 74%" impresso no
            # treino media uma correspondenca que nao existe.
            # ## O alvo precisa combinar com a negativa
            #
            # Ate a fila encher, `neg = g` tem so `len(x)` colunas e o alvo
            # correto e a posicao da linha no lote. Depois, `neg` tem 1.106
            # colunas e o alvo passa a ser a posicao **na galeria**. Usar o
            # indice de galeria com a negativa do lote estoura
            # `cross_entropy` com `t < n_classes` — que e o assert que apareceu
            # na primeira tentativa.
            usando_fila = fila is not None and fila.cheio
            if usando_fila:
                neg = fila.banco
            else:
                neg = g
                alvo = torch.arange(len(x), device=device)

            logits = e @ neg.T / TEMPERATURA
            perda_nce = F.cross_entropy(logits, alvo)

            # arrasto direto: o par certo tem de ficar em coseno alto, sem
            # depender de a temperatura estar calibrada
            positivo = (e * g).sum(dim=1)
            perda = perda_nce + (1.0 - positivo).mean()

            opt.zero_grad()
            perda.backward()
            opt.step()

            tot += len(x)
            acertos += (logits.argmax(1) == alvo).sum().item()
            perda_v = perda.item()

        # ## Uma passada extra por epoca, nao por passo
        #
        # A fila precisa da arte codificada **em modo de inferencia** — o
        # encoder foi treinado acima e os gradientes das update contaminariam
        # o banco. Uma passada por epoca custa segundos; refazer a cada passo
        # custaria o treino inteiro de novo.
        if fila is not None and dl_gal is not None:
            emb_gal = fila.encoder(modelo, dl_gal.dataset.tensores)
            if emb_gal is not None:
                fila.atualizar(emb_gal)

        print(
            f"epoca {ep+1:3d}/{epocas}  perda {perda_v:.4f}  "
            f"top-1 {acertos/max(tot,1):.1%}"
        )

    exportar(modelo, device)


def exportar(modelo, device):
    SAIDA.mkdir(parents=True, exist_ok=True)
    modelo.eval()
    # um passo para o BatchNorm materializar as medias e variancias
    #
    # Sem isso o ONNX exporta com BatchNorm ainda como operador de treino, o
    # grafo fica minimo e o arquivo sai com 0,3 MB em vez de ~4,3 MB. O
    # tamanho errado nao erra porLuck: erra porque o modelo salvo e um
    # esqueleto, e so quebra na inferencia, muito depois.
    with torch.no_grad():
        modelo(torch.randn(4, 3, LADO, LADO, device=device))

    dummy = torch.randn(1, 3, LADO, LADO, device=device)

    caminho = SAIDA / "encoder.onnx"
    torch.onnx.export(
        modelo,
        dummy,
        str(caminho),
        input_names=["imagem"],
        output_names=["embedding"],
        dynamic_axes={"imagem": {0: "lote"}, "embedding": {0: "lote"}},
        opset_version=17,
        # o exportador novo (dynamo) produz um arquivo de 0,3 MB neste mesmo
        # grafo; o legado produz 4,3 MB, que bate com 1.075.232 parametros em
        # fp32. A diferenca nao e otimizacao: e o BatchNorm em modo de treino
        # sobrando no grafo, e so quebra na inferencia.
        dynamo=False,
    )
    mb = caminho.stat().st_size / 1e6
    print(f"\nONNX: {caminho}  ({mb:.1f} MB)")

    torch.save(modelo.state_dict(), SAIDA / "encoder.pt")
    print(f"pesos: {SAIDA / 'encoder.pt'}")

    if mb > 12:
        print(
            f"\nAVISO: {mb:.1f} MB ultrapassa o alvo de ~5 MB. "
            "Se quiser cortar, quantize para int8 ou troque por efficientnet-lite0."
        )


if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        dry_run()
    else:
        main()
