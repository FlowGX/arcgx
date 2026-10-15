"""
Avaliacao honesta: cada recorte contra a GALERIA INTEIRA.

## Por que a metrica de treino nao serve

O `top-1` impresso a cada epoca compara o recorte contra **os outros itens do
mesmo lote** — cerca de 31 negativos. Na inferencia real o classificador ve
1.106 candidatos, e um item que ganha de 31 pode perder de 1.100.

Um numero de treino alto aqui e normal; um numero alto aqui **nao diz nada**
sobre o app. A medida que vale e o recall@k contra a galeria completa.

## O que este script faz

1. Embedding do modelo treinado para todos os 1.106 itens de catalogo
2. Embedding para cada recorte rotulado
3. Para cada recorte, ordena a galeria por similaridade e ve a posicao do
   item verdadeiro
4. Reporta recall@1, @5, @15 e a mediana da posicao

E o numero que vai para o app decidir os vizinhos.
"""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import torchvision.transforms as T
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import importlib.util

RAIZ = Path(r"H:\Arcgxapp")
LOTE = RAIZ / "dados" / "rotulo" / "lote"
CACHE_ART = RAIZ / "dados" / "rotulo" / "cache-arte"
CATALOGO = RAIZ / "dados" / "game" / "items.json"
GABARITO = RAIZ / "dados" / "rotulo" / "gabarito.json"
PESOS = RAIZ / "ml" / "modelo" / "encoder.pt"

spec = importlib.util.spec_from_file_location("t", RAIZ / "ml" / "treinar.py")
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)

LADO = t.LADO
NORMALIZA = T.Compose(
    [
        T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)


def _arte(item):
    """Abre a arte do item, baixando se preciso.

    ## Por que nao reusa o cache

    O cache em `dados/rotulo/cache-arte` usa `abs(hash(url))` como nome — e
    `hash()` do Python e **randomizado por processo** (`PYTHONHASHSEED`). O
    `gerar-vizinhos.py` gravou com uma seed, este processo ve outra, e o nome
    nunca bate. A galeria vinha vazia, sem erro, e a avaliacaoacusava "nenhum
    rotulo casou".

    A correcao e md5 da URL, que e estavel entre processos e entre maquinas.
    """
    url = item["imageFilename"]
    chave = hashlib.md5(url.encode()).hexdigest()
    p = CACHE_ART / f"{chave}.png"
    if not p.exists():
        try:
            import urllib.request

            CACHE_ART.mkdir(parents=True, exist_ok=True)
            req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
            with urllib.request.urlopen(req, timeout=20) as r:
                p.write_bytes(r.read())
        except Exception:
            return None
    try:
        return Image.open(p).convert("RGB").resize((LADO, LADO), Image.BILINEAR)
    except Exception:
        return None


def _arte_rgba(item):
    """Arte crua em RGBA, do mesmo cache md5 de `treinar.py`.

    `_arte` redimensiona e joga o alpha fora —util para comparar embedding,
    mas nao serve para **enquadrar**, que precisa da transparencia para
    compor o sprite sobre a celula.
    """
    url = item["imageFilename"]
    chave = hashlib.md5(url.encode()).hexdigest()
    p = CACHE_ART / f"{chave}.png"
    if not p.exists():
        return _arte(item) and Image.open(CACHE_ART / f"{chave}.png").convert("RGBA")
    try:
        return Image.open(p).convert("RGBA")
    except Exception:
        return None


def emb(imagens, modelo, device):
    saida = []
    with torch.no_grad():
        for i in range(0, len(imagens), 32):
            # `torch.cat` de tensores 3D (C,H,W) empilha no eixo 0, e vira
            # (64*3, H, W) — o modelo ve 192 canais e estoura. O lote precisa
            # ter o eixo de batch explicito: `stack`, nao `cat`.
            bloco = torch.stack([NORMALIZA(im) for im in imagens[i : i + 32]]).to(device)
            saida.append(F.normalize(modelo(bloco), dim=1))
    return torch.cat(saida) if saida else torch.zeros(0, t.DIM, device=device)


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    modelo = t.Encoder().to(device)
    modelo.load_state_dict(torch.load(PESOS, map_location=device))
    modelo.eval()

    itens = [
        i
        for i in (json.loads(CATALOGO.read_text(encoding="utf-8")).get("items") or {}).values()
        if i.get("imageFilename")
    ]

    galeria, ids = [], []
    # ## A galeria precisa da MESMA moldura usada no treino
    #
    # O `treinar.py` enquadra a arte do catalogo na celula (fundo escuro,
    # cunha de raridade, barra neutra) antes de codificar. Avaliar contra a
    # arte pura mede o encoder contra um dominio que ele nunca viu: foi o que
    # deu recall@1 de 0,3% numa primeira versao desta medicao, e o numero
    # nao dizia nada sobre o modelo.
    mold = None
    try:
        import moldura as _mold

        _cat = _mold.carregar_catalogo()
        _base, _ = _mold.template_base(LOTE)
        mold = _mold.Moldura(
            base_arr=np.asarray(_base, dtype=np.float32),
            paleta=_mold.cores_raridade(_cat, LOTE),
        )
        print("moldura: mesma do treino")
    except Exception as e:
        print(f"aviso: avaliando sem moldura ({e})")

    def arte_do_item(it):
        img = _arte_rgba(it)
        if img is None:
            return None
        if mold is not None and it.get("rarity") in mold.paleta:
            img = mold.enquadrar_arte(img, mold.paleta[it["rarity"]])
        else:
            img = img.convert("RGB")
        return img.resize((LADO, LADO), Image.BILINEAR)

    for it in itens:
        img = arte_do_item(it)
        if img is None:
            continue
        galeria.append(img)
        ids.append(it["id"])

    gab = json.loads(GABARITO.read_text(encoding="utf-8"))
    pares = []
    for cap, celulas in (gab.get("capturas") or {}).items():
        for idx, item in (celulas or {}).items():
            if not item or item == "VAZIA":
                continue
            p = LOTE / cap / f"{idx}.png"
            if p.exists():
                pares.append((p, item))

    print(f"galeria : {len(galeria)} itens")
    print(f"recortes: {len(pares)} rotulados\n")

    g = emb(galeria, modelo, device)
    recortes = []
    for p, _ in pares:
        im = Image.open(p).convert("RGB")
        if mold is not None:
            im = mold.enquadrar_recorte(im)
        recortes.append(im.resize((LADO, LADO), Image.BILINEAR))
    r = emb(recortes, modelo, device)

    indice = {v: k for k, v in enumerate(ids)}
    sim = r @ g.T

    posicoes = []
    fora = 0
    for linha, (_, certo) in enumerate(pares):
        j = indice.get(certo)
        if j is None:
            fora += 1
            continue
        ordem = torch.argsort(sim[linha], descending=True)
        pos = int((ordem == j).nonzero()[0, 0])
        posicoes.append(pos + 1)  # 1-based

    if not posicoes:
        raise SystemExit("nenhum rotulo casou com a galeria")

    p = np.array(posicoes)
    print("=== posicao do item verdadeiro na ordenacao ===")
    for k in (1, 3, 5, 10, 15, 25, 50):
        print(f"  recall@{k:<3} {(p <= k).mean():6.1%}   ({(p<=k).sum()}/{len(p)})")
    print(f"\n  mediana   {int(np.median(p))}")
    print(f"  pior caso {p.max()}")
    print(f"  fora da galeria: {fora}")

    # similaridade do item verdadeiro
    # `linhas` tem menos elementos que `p` quando algum rotulo nao casou com a
    # galeria; indexar com `np.arange(len(p))` sobre `sim` (que tem uma linha
    # a mais) estoura com shape mismatch.
    sim_certa = []
    linha = 0
    for _, certo in pares:
        j = indice.get(certo)
        if j is None:
            continue
        sim_certa.append(float(sim[linha, j]))
        linha += 1
    if sim_certa:
        print(f"\n  similaridade do item certo: mediana {np.median(sim_certa):.3f}")


if __name__ == "__main__":
    main()