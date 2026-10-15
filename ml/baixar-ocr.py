"""
Baixa os modelos do PaddleOCR v5 mobile.

## Escolha do conjunto

- `PP-OCRv5_mobile_det.onnx` (4,75 MB) — acha as caixas de texto
- `latin_PP-OCRv5_mobile_rec` (8,05 MB) — lê o conteúdo

`latin`, e nao `ch` nem `en`: o jogo mostra rotulos em portugues e ingles, e o
modelo latino cobre os dois com um arquivo so. O `ch` traria 16,6 MB e nao
resolveria nada aqui.

## Licenca

Apache-2.0 (o `PaddlePaddle` oficial publica os ONNX com essa licenca) — uso
livre, e a atribuicao vai para os creditos do app.

## O que NAO entra

O classificador de item do ARC Tracker nao entra. E proprietario, e treinar o
nosso e justamente o que estamos fazendo.
"""

import json
import urllib.request
from pathlib import Path

DESTINO = Path(r"H:\Arcgxapp\ml\modelo\ocr")

MODELOS = [
    {
        "nome": "PP-OCRv5_mobile_det.onnx",
        "url": "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx",
        "papel": "deteccao de caixas de texto",
    },
    {
        "nome": "latin_PP-OCRv5_mobile_rec.onnx",
        "url": "https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx",
        "papel": "reconhecimento de texto (latino: pt + en)",
    },
]


def baixar(url, destino):
    req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        dados = r.read()
    destino.write_bytes(dados)
    return len(dados)


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    manifesto = {"versao": 1, "licenca": "Apache-2.0 (PaddleOCR)", "modelos": []}

    for m in MODELOS:
        alvo = DESTINO / m["nome"]
        if alvo.exists():
            mb = alvo.stat().st_size / 1e6
            print(f"{m['nome']}: ja existe ({mb:.2f} MB)")
        else:
            print(f"{m['nome']}: baixando…", flush=True)
            try:
                n = baixar(m["url"], alvo)
                print(f"{m['nome']}: {n/1e6:.2f} MB")
            except Exception as e:
                print(f"{m['nome']}: FALHOU — {e}")
                continue

        manifesto["modelos"].append(
            {"arquivo": m["nome"], "papel": m["papel"], "url": m["url"]}
        )

    (DESTINO / "manifesto.json").write_text(json.dumps(manifesto, indent=2), encoding="utf-8")
    total = sum((DESTINO / m["nome"]).stat().st_size for m in MODELOS if (DESTINO / m["nome"]).exists())
    print(f"\ntotal OCR: {total/1e6:.2f} MB  -> {DESTINO}")


if __name__ == "__main__":
    main()
