"""
Baixa o dicionario de caracteres do PP-OCRv5 mobile rec.

## Por que ele nao vem no ONNX

O `rec` devolve indices numericos — 838 deles, um por glifo. O mapa
indice->caractere mora num `.txt` separado no repositorio do PaddleOCR. Sem
ele a OCR roda "certinho" e devolve uma sequencia de numeros, que e o tipo de
falha que so aparece quando alguem le o resultado e ve `[[62, 31], [17, 9]]`.

Alem disso, o dicionario carrega dois campos que o ONNX tambem nao tem:
`use_space` (o id reservado ao espaco em branco) e o idioma. O espaco e
silencioso — sem ele, as palavras saem coladas, o que derruba qualquer
casamento de nome de item.
"""

import json
import urllib.request
from pathlib import Path

DESTINO = Path(r"H:\Arcgxapp\ml\modelo\ocr")

CANDIDATOS = [
    (
        "ppocr_keys_v1.txt",
        "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt",
    ),
    (
        "en_dict.txt",
        "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/en_dict.txt",
    ),
    (
        "latin_dict.txt",
        "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/latin_dict.txt",
    ),
]


def tentar(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    escolha = None

    for nome, url in CANDIDATOS:
        try:
            txt = tentar(url)
        except Exception as e:
            print(f"{nome}: indisponivel ({type(e).__name__})")
            continue

        linhas = [l.rstrip("\n") for l in txt.splitlines()]
        # o dicionario comeca com um espaco reservado; linhas vazias no meio
        # sao glifos legitimos e precisam ser preservadas
        while linhas and linhas[-1] == "":
            linhas.pop()

        if len(linhas) < 800:
            print(f"{nome}: so {len(linhas)} entradas — curto demais para o rec de 838")
            continue

        destino = DESTINO / nome
        destino.write_text("\n".join(linhas) + "\n", encoding="utf-8")

        with_destino = DESTINO / f"{nome}.json"
        with_destino.write_text(
            json.dumps(
                {
                    "fonte": url,
                    "licenca": "Apache-2.0 (PaddleOCR)",
                    "total": len(linhas),
                    "use_space": True,
                    "caracteres": linhas,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        print(f"{nome}: {len(linhas)} caracteres  -> {destino}")
        # o glifo de espaco fica na posicao 0 na maioria dos dicionarios
        print(f"   [0]={linhas[0]!r}  [1]={linhas[1]!r}  [last]={linhas[-1]!r}")
        escolha = with_destino
        break

    if escolha is None:
        print("\nnenhum dicionario serviu — a OCR ainda nao pode decodificar saida")
        return

    print(f"\npronto: {escolha}")


if __name__ == "__main__":
    main()
