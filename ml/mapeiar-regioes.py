"""
Mapeia as regioes de tela que o app vai ler.

## Por que comecar pelas coordenadas

Definir "quais telas importam" em abstracao e escolher regioes depois leva a
construir-reader generico que nao le nada. O inverso — olhar os prints que ja
temos e marcar onde esta cada informacao — produz algo que funciona no primeiro
teste e se ajusta por evidencia.

Todas as telas importam, entao o trabalho aqui e **cobrir**, nao escolher.
O que separa o que da para ler hoje do que ainda nao e o tipo de texto: a barra
de topo do HUD ja produz leituras limpas nesta prova de conceito; o resto da
tela depende de a deteccao acertar os icones, e ela ainda nao faz.
"""

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
OCR = RAIZ / "ml" / "modelo" / "ocr"
PENDENTE = RAIZ / "dados" / "rotulo" / "pendente"
SAIDA = RAIZ / "dados" / "rotulo" / "regioes.json"

import importlib.util

spec = importlib.util.spec_from_file_location("t", RAIZ / "ml" / "testar-ocr.py")
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)


def sessoes():
    return (
        ort.InferenceSession(str(OCR / "PP-OCRv5_mobile_det.onnx"), providers=["CPUExecutionProvider"]),
        ort.InferenceSession(str(OCR / "latin_PP-OCRv5_mobile_rec.onnx"), providers=["CPUExecutionProvider"]),
    )


def frames():
    """Todos os frames brutos coletados, como o jogo estava em cada um."""
    for pasta in sorted(PENDENTE.glob("inv-*")):
        meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
        yield pasta, meta


def para_png(pasta, meta):
    raw = (pasta / "frame.raw").read_bytes()
    w, h = meta["frame"]["width"], meta["frame"]["height"]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    arr = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 4)
    rgba[..., 0] = arr[..., 2]  # B -> R
    rgba[..., 1] = arr[..., 1]
    rgba[..., 2] = arr[..., 0]
    rgba[..., 3] = 255
    return Image.fromarray(rgba, "RGBA").convert("RGB")


def main():
    det, rec = sessoes()
    limites = 1920, 1080

    # ## As regioes
    #
    # Fracoes de tela, nao pixels: o ROI do inventario ja funciona assim, e
    # 1920x1080 e so a resolucao em que a geometria foi medida. Fixar pixel
    # aqui faria a regiao errar em qualquer outra resolucao.
    #
    # `peso` e a confianca de que ali ha texto — e o que ordena o trabalho:
    # comeca pelo que ja sai limpo.
    regioes = [
        {"id": "hud_topo", "nome": "Barra de topo (timers, cooldowns)",
         "x": 0.0, "y": 0.0, "width": 1.0, "height": 0.075, "peso": 3,
         "nota": "ja produz leitura limpa: 'A7:241', '1:35'"},
        {"id": "hud_canto_dir", "nome": "Canto superior direito (moeda, contadores)",
         "x": 0.78, "y": 0.0, "width": 0.22, "height": 0.06, "peso": 3,
         "nota": "numeros grandes, leitura confiavel"},
        {"id": "hud_rodape", "nome": "Rodape (vida, fome, temperatura)",
         "x": 0.0, "y": 0.93, "width": 0.55, "height": 0.07, "peso": 3,
         "nota": "barras com valor numerico"},
        {"id": "inventario_contador", "nome": "Contador do inventario",
         "x": 0.08, "y": 0.68, "width": 0.30, "height": 0.06, "peso": 3,
         "nota": "'436.8' e '834' — leitura ja confirmada"},
        {"id": "painel_lateral_dir", "nome": "Painel direito (missao ativa)",
         "x": 0.76, "y": 0.10, "width": 0.24, "height": 0.55, "peso": 2,
         "nota": "nome e progresso da missao"},
        {"id": "painel_lateral_esq", "nome": "Painel esquerdo (objetivos)",
         "x": 0.0, "y": 0.12, "width": 0.24, "height": 0.55, "peso": 2,
         "nota": "lista de objetivos"},
        {"id": "nome_item_hover", "nome": "Nome do item (hover/tooltip)",
         "x": 0.0, "y": 0.45, "width": 0.45, "height": 0.14, "peso": 2,
         "nota": "tooltip ao passar o mouse"},
        {"id": "centro_tela", "nome": "Centro (crosshair, loot do mundo)",
         "x": 0.30, "y": 0.30, "width": 0.40, "height": 0.40, "peso": 1,
         "nota": "pior regiao: muita arte, pouco texto"},
    ]

    print("regioes definidas:", len(regioes))
    SAIDA.write_text(
        json.dumps(
            {
                "versao": 1,
                "medidoEm": [limites[0], limites[1]],
                "regioes": regioes,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # ## Medir cada regiao em cada frame
    print("\nmedindo leitura por regiao (5 frames):\n")

    amostras = list(frames())[:5]
    resumo = {r["id"]: [] for r in regioes}

    for pasta, meta in amostras:
        img = para_png(pasta, meta)
        w, h = img.size
        for r in regioes:
            box = (
                int(r["x"] * w),
                int(r["y"] * h),
                int((r["x"] + r["width"]) * w),
                int((r["y"] + r["height"]) * h),
            )
            recorte = img.crop(box)
            cx = ocr.detectar(det, np.asarray(recorte), limiar=0.5)
            textos = []
            for b in cx:
                t, c = ocr.reconhecer(rec, recorte.crop(b))
                if t.strip() and c >= 0.75:
                    textos.append(t)
            resumo[r["id"]].append((len(cx), textos))

    for r in regioes:
        Amostras = resumo[r["id"]]
        total_caixas = sum(a[0] for a in Amostras)
        todos = [t for a in Amostras for t in a[1]]
        unicos = sorted(set(todos))
        print(f"{r['id']:22} peso {r['peso']}  caixas {total_caixas:4}  leituras {len(unicos):3}")
        if unicos:
            print(f"    {', '.join(repr(u) for u in unicos[:10])}")

    print(f"\n-> {SAIDA}")


if __name__ == "__main__":
    main()
