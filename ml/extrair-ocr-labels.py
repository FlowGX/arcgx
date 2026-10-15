"""
Extrai rotulos de texto sem mao.

## A ideia

Treinar um detector precisa de caixas de texto — outro trabalho manual, apos o
dos itens. Mas `det` e `rec` concordam sobre o que e texto, e discordam sobre
o que e icone. essa discrepancia e o rotulo:

- `det` propoe uma caixa
- `rec` le os pixels daquela caixa
- se o resultado parece **palavra** (latin + digitos, alta proporcao), a caixa
  e texto de verdade
- se vira `'WPMUBS'`, era icone

Nao e verdade sem ressalva: `rec` sempre devolve algo. O filtro e o que separa
as duas coisas, e por isso a taxa de faux positivos importa — por isso o script
imprime a_amostra_bruta em vez de so o saldo.

## O que isso entrega

Triplas (recorte, texto) ja alinhadas com a caixa. E o insumo de um
reconhecedor. Para o **detector**, o rotulo e a caixa em si, e ai entra um
filtro de consistencia: a mesma caixa recorrendo em frames diferentes do mesmo
HUD e evidencia de layout fixo.

O que este script NAO finge: um detector treinado em pseudo-rotulo pode herdar
o vies do `det`. Isso esta anotado no final, e e o limite do metodo.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
OCR = RAIZ / "ml" / "modelo" / "ocr"
PENDENTE = RAIZ / "dados" / "rotulo" / "pendente"
SAIDA = RAIZ / "dados" / "rotulo" / "ocr-dataset.json"

import importlib.util

spec = importlib.util.spec_from_file_location("t", RAIZ / "ml" / "testar-ocr.py")
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)

# ## Por que este filtro e o inverso do primeiro
#
# A primeira versao aceitava palavra e contava vogais. Os dados responderam:
# ela ACEITOU `'NFOUP'`, `'JFOUP'`, `'AA:241'` (que e lixo de icone) e
# REJEITOU `'771'`, `'6:29'`, `'1:31'`, `'HVSP1:2'` (que sao legiveis).
#
# Contar vogais nao funciona em portugues: a maior parte das vogais e acentuada
# (`a`, `e`, `i`, `o`) e o `rec` erra justamente nesses acentos. `'HVSP1:2'`
# tem 2 vogais em 6 e foi reprovado; `'NFOUP'` tem 3 e passou.
#
# O dado do jogo nao e palavra — e numero, relogio, contador, sigla de item.
# Entao o filtro casa com **forma de dado**, nao com palavra: digitos, dois
# pontos, barra, virgula, sinal. E o que sobra vira `suspeito` em vez de ser
# descartado, para nao perder leitura boa por duvida.
PADRAO_DADO = re.compile(r"^[0-9:/\-.,%‐+]+$")
TEM_NUMERO = re.compile(r"\d")


def parece_texto(t):
    if len(t) < 2:
        return False
    # dado: so digito, pontuacao de relogio/contador, e things like 'x20'
    so_dado = PADRAO_DADO.match(t.replace(" ", ""))
    if so_dado and TEM_NUMERO.search(t):
        return True
    return False


def principal():
    det = ort.InferenceSession(str(OCR / "PP-OCRv5_mobile_det.onnx"), providers=["CPUExecutionProvider"])
    rec = ort.InferenceSession(str(OCR / "latin_PP-OCRv5_mobile_rec.onnx"), providers=["CPUExecutionProvider"])

    pastas = sorted(PENDENTE.glob("inv-*"))
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else len(pastas)
    pastas = pastas[:limite]

    amostras = Counter()
    total_caixas = 0
    aproveitadas = []
    por_regiao = Counter()

    for pasta in pastas:
        meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
        raw = (pasta / "frame.raw").read_bytes()
        w, h = meta["frame"]["width"], meta["frame"]["height"]
        arr = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 4)
        rgb = np.dstack([arr[..., 2], arr[..., 1], arr[..., 0]])
        img = Image.fromarray(rgb)

        caixas = ocr.detectar(det, rgb, limiar=0.5)
        total_caixas += len(caixas)

        for b in caixas:
            t, conf = ocr.reconhecer(rec, img.crop(b))
            t = t.strip()
            if not t:
                continue
            amostras[t] += 1
            if conf >= 0.8 and parece_texto(t):
                aproveitadas.append(
                    {
                        "captura": pasta.name,
                        "box": list(b),
                        "texto": t,
                        "conf": round(conf, 3),
                        "largura": b[2] - b[0],
                        "altura": b[3] - b[1],
                    }
                )
                por_regiao[(b[0] // 200) * 200] += 1

    print(f"frames: {len(pastas)}")
    print(f"caixas propostas: {total_caixas}")
    print(f"aceitas: {len(aproveitadas)}  ({len(aproveitadas)/max(total_caixas,1):.1%})\n")

    print("20 leituras mais frequentes (amostra da qualidade):")
    for t, n in amostras.most_common(20):
        marca = "OK " if parece_texto(t) else "-- "
        print(f"  {marca}{n:4}x  {t!r}")

    unicas = sorted({a["texto"] for a in aproveitadas})
    print(f"\ntextos distintos aceitos: {len(unicas)}")
    print(f"  {', '.join(repr(u) for u in unicas[:25])}")

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(
        json.dumps(
            {
                "versao": 1,
                "origem": "pseudo-rotulo det+rec",
                "frames": len(pastas),
                "caixas": total_caixas,
                "aceitas": len(aproveitadas),
                "distintos": unicas,
                "amostras": aproveitadas,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {SAIDA}")
    print(
        "\nLIMITE DO METODO: pseudo-rotulo herda o vies do `det`. "
        "Um detector treinado aqui pode errar onde o `det` erra. "
        "A valida���ao honesta e comparar com rotulo manual numa amostra."
    )


if __name__ == "__main__":
    principal()