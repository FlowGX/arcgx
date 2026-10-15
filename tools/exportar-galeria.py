"""
Exporta a galeria de embeddings para o app.

## ## ## Por que pre-calcular

O encoder roda **uma vez** sobre cada arte do catalogo e produz um vetor de
256 floats. Sao 1.106 itens, 1,1 MB. Recalcular isso a cada quadro seria
absurdo — e nao e necessario, porque **o catalogo nao muda**.

O app carrega o binario uma vez no arranque e o scan multiplica matrizes.

Medido em `tools/medir-224.py`: a grade de 20 celulas custa 15,61 ms com o
lote. A galeria nao entra nesse numero — ela ja esta em memoria.

## ## ## O que vai no binario

    [magic 4B][n_itens u32][dim u32][ids_json_len u32][ids_json][N x 256 f32]

Tudo little-endian. O bloco de ids vai como JSON porque o indice da matriz
nao diz qual item e, e um item sem nome no app e inutil.

## ## ## Por que o ONNX vai junto

O app precisa do `.onnx`, nao so dasembeddings. Este script copia
`encoder-arte.onnx` para `apps/main/resources/` e escreve um manifesto com a
resolucao e o sha256 — o `spaceId` do ARC Tracker usa o mesmo ideio: trocar o
modelo invalida a galeria, e isso precisa ser detectavel.
"""

import hashlib
import json
import struct
import sys
from pathlib import Path

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
DESTINO = RAIZ / "apps" / "main" / "resources\\_galeria"

## Os dois lados vem do **mesmo** treino. Nao usar `ec.carregar_encoder()`
## aqui: ele segue a env `ENCODER`, que por padrao aponta para `encoder.pt`
## (112 px, com rotulos). Os vetores saiam desse modelo enquanto o `.onnx`
## entregue ao app era o `encoder-arte` (224 px, sem rotulos) — e a busca
## passava a devolver ~0,14 em vez de ~1,00 sem nenhum erro em lugar nenhum.
## O `sha256` do manifesto era o do `.onnx`, entao nem o espaco denunciava.
ENCODER_PT = RAIZ / "ml" / "modelo" / "encoder-arte.pt"
ENCODER_ONNX = RAIZ / "ml" / "modelo" / "encoder-arte.onnx"

MAGIC = b"GXGB"


def exportar():
    import numpy as np
    ## `ml/` precisa estar no path: `encoder_comum` e um modulo solto la, e o
    ## script vive em `tools/`. Sem isto o erro e `ModuleNotFoundError` com o
    ## nome do modulo e nada sobre o path — a pista errada.
    sys.path.insert(0, str(ML))
    import encoder_comum as ec

    device = "cpu"
    ## Carrega o `.pt` **pelo caminho**, ignorando a env `ENCODER`. Ver
    ## `ENCODER_PT` acima para o que essa indirecao custava.
    import torch

    from treinar import Encoder

    modelo = Encoder()
    estado = torch.load(ENCODER_PT, map_location=device, weights_only=True)
    modelo.load_state_dict(estado)
    modelo.eval()
    modelo.to(device)
    mold = ec.carregar_moldura()

    ids, embs = [], []
    for it in ec.carregar_itens():
        im = ec.arte_framed(it, mold=mold)
        if im is None:
            continue
        ids.append(it["id"])
        embs.append(im)

    print(f"itens com arte: {len(ids)}")
    print("codificando galeria...")
    g = ec.emb(embs, modelo, device)  # (N, 256) ja L2-normalizado
    arr = g.cpu().numpy().astype(np.float32)

    DESTINO.mkdir(parents=True, exist_ok=True)
    bin_path = DESTINO / "galeria.bin"

    ids_json = json.dumps(ids, ensure_ascii=False).encode("utf-8")
    with open(bin_path, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<III", len(ids), arr.shape[1], len(ids_json)))
        f.write(ids_json)
        f.write(arr.tobytes())

    modelo_destino = DESTINO / "encoder.onnx"
    modelo_destino.write_bytes(ENCODER_ONNX.read_bytes())
    sha_onnx = hashlib.sha256(ENCODER_ONNX.read_bytes()).hexdigest()
    sha_pt = hashlib.sha256(ENCODER_PT.read_bytes()).hexdigest()

    manifesto = {
        "itens": len(ids),
        "dim": int(arr.shape[1]),
        "lado": ec.LADO,
        "normalizado": "l2",
        "espaco": f"model-{sha_pt[:12]}",
        "sha256": sha_pt,
        "sha256_onnx": sha_onnx,
        "origem": "ml/treinar-arte.py",
        "encoder": ENCODER_PT.name,
        "rotulos": 0,
    }
    (DESTINO / "manifesto.json").write_text(
        json.dumps(manifesto, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\ngaleria.bin     {bin_path.stat().st_size / 1e6:.2f} MB")
    print(f"encoder.onnx   {modelo_destino.stat().st_size / 1e6:.2f} MB")
    print(f"lado           {ec.LADO}")
    print(f"dim            {arr.shape[1]}")
    print(f"espaco         {manifesto['espaco']}")
    print(f"-> {DESTINO}")

    ## Sanidade: a matriz tem que estar normalizada, senao a busca por cosseno
    ## fica silenciosamente errada — e o app nao tem como avisar.
    n = np.linalg.norm(arr, axis=1)
    print(f"\nnorma dos embeddings: min {n.min():.4f} max {n.max():.4f}")
    if abs(n.mean() - 1.0) > 0.01:
        print("AVISO: vetores nao estao normalizados em L2")

    ## O teste que faltava: a arte do catalogo tem que casar **consigo mesma**.
    ## Os dois ultimos scripts divergiam entre 0,14 e 1,00 sem erro nenhum, e
    ## a unica pista era a nota acima. Aqui a falha e fatal.
    import numpy as np

    alvo = "agave" if "agave" in ids else ids[0]
    alvo_im = next(i for i in ec.carregar_itens() if i["id"] == alvo)
    v = ec.emb([ec.arte_framed(alvo_im, mold=mold)], modelo, device)
    v = v.cpu().numpy().ravel()
    sims = arr @ v
    k = int(np.argmax(sims))
    print(f"auto-casamento: '{alvo}' -> '{ids[k]}' {sims[k]:.4f}")
    if ids[k] != alvo or sims[k] < 0.95:
        raise SystemExit(
            f"\nFALHA: '{alvo}' nao casou consigo mesmo ({sims[k]:.4f}).\n"
            "Os vetores e o encoder.onnx vem de treinamentos diferentes.\n"
            "Nao distribua esta galeria — reexporte do mesmo .pt/.onnx."
        )
    print("ok: vetores e onnx vem do mesmo modelo")


if __name__ == "__main__":
    exportar()
