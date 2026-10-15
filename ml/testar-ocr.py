"""
Prova de conceito do OCR, do pixel ao texto.

## Por que um script solto e nao a integracao

A integracao no app vai rodar em Node, via `onnxruntime-node` + DirectML. Este
script roda em Python, em CPU. A purpose nao e producao: e responder se o
ONNX decodifica texto de tela de jogo **antes** de construir o pipeline em
volta. Descobrir que o dicionario estava trocado ou que o pre-processamento
exige normalizacao especifica so aqui custa dois minutos.

O que ele valida, em ordem:
1. o `det` acha caixa de texto num print real
2. o recorte alimenta o `rec`
3. o `rec` devolve indices que viram **caractere**, e nao numero
4. o texto sai legivel
"""

import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
OCR = RAIZ / "ml" / "modelo" / "ocr"
PRINTS = RAIZ / "dados" / "rotulo" / "teste-ocr"

DIC = json.loads((OCR / "dicionario.json").read_text(encoding="utf-8"))
GLIFOS = DIC["caracteres"]
ID_BRANCO = len(GLIFOS) + 1  # o CTC reserva o primeiro indice para "nada"


def sessao(nome):
    return ort.InferenceSession(str(OCR / nome), providers=["CPUExecutionProvider"])


def obter_prINTS():
    """
    Testa num frame real do jogo, e nao numa foto de rosto.

    A primeira tentativa usou uma imagem generica e a deteccao devolveu zero
    caixas — a resposta correta para uma foto sem texto, e um teste que nao
    prova nada. O HUD do jogo tem rotulo, numero e nome de item: se o OCR
    nao le isso, o problema e real e nao do teste.
    """
    PRINTS.mkdir(parents=True, exist_ok=True)
    p = PRINTS / "jogo.png"
    if not p.exists():
        raise SystemExit(
            f"falta {p}\nGere antes com: node (converte um frame de dados/rotulo/pendente)"
        )
    return [p]


def detectar(sess, img, limiar=0.3, lado_max=960):
    """
    PP-OCRv5 det.

    ## Tres coisas, e as tres importam

    1. **Redimensiona antes.** O treino usa `limit_side_len=960` no lado
       maior; a inferencia sem isso recebe uma imagem fora da escala esperada.
       Aqui, entrar com os 1920 px de tela cheia produz caixas espalhadas por
       cima dos icones — o `rec` devolve letras aleatorias ('WPMUBS') com
       confianca alta, porque ele le um recorte que nao tem texto nenhum.

    2. **Normaliza (img/255 - 0.5) / 0.5**, e nao media/desvio da ImageNet.
       ImageNet aqui desloca a escala e devolve uma caixa unica gigantesca.

    3. **O `db` ja esta embutido.** A saida e `1 x H x W`, mapa de
       probabilidade. Falta limiarizar e agrupar componentes.
    """
    h, w = img.shape[:2]

    escala = min(1.0, lado_max / max(h, w))
    nw = max(32, int(round(w * escala / 32) * 32))
    nh = max(32, int(round(h * escala / 32) * 32))

    pequeno = Image.fromarray(img).resize((nw, nh), Image.BILINEAR)
    arr = (np.asarray(pequeno, dtype=np.float32)[:, :, ::-1].transpose(2, 0, 1) / 255.0 - 0.5) / 0.5

    mapa = sess.run(None, {"x": arr[None]})[0][0, 0]
    mascara = mapa > limiar

    ys, xs = np.where(mascara)
    if len(xs) == 0:
        return []

    inv = escala or 1.0
    caixas = []
    usados = np.zeros(len(xs), dtype=bool)
    for i in np.argsort(ys):
        if usados[i]:
            continue
        janela = (np.abs(xs - xs[i]) < 40) & (np.abs(ys - ys[i]) < 12) & (~usados)
        usados |= janela
        x0 = max((int(xs[janela].min()) - 6) / inv, 0)
        x1 = min((int(xs[janela].max()) + 6) / inv, w - 1)
        y0 = max((int(ys[janela].min()) - 6) / inv, 0)
        y1 = min((int(ys[janela].max()) + 6) / inv, h - 1)
        if x1 - x0 > 12 and y1 - y0 > 8:
            # Texto e largo e baixo; icone do inventario e quadrado. Sem isso,
            # os 5.452 contêineres coloridos do mapa viram caixa de texto e o
            # `rec` le letras aleatorias com confianca alta ('WPMUBS'), que e
            # pior que nao ler nada: parece que o OCR funciona.
            largura = x1 - x0
            altura = y1 - y0
            if largura / max(altura, 1) < 1.6:
                continue
            caixas.append((int(x0), int(y0), int(x1), int(y1)))

    return caixas


def reconhecer(sess, recorte):
    """
    Decodifica CTC: indice 0 e o blank.

    ## Como isso foi medido, e nao deduzido

    Com o pre-processamento do `det` corrigido, a saida sai assim:

        '0D0F0T0D0w0'
         ^^^^ blank entre cada letra, padrao classico de CTC

    O indice 0 aparece com confianca alta e envolve cada glifo. Duas leituras
    erradas custaram tempo aqui: tratar 0 como glifo (`'0'`, o digito) joga
    zeros no meio de cada palavra; e deslocar o mapa em -1 desalinha todos os
    caracteres. O indice 0 e blank, e `GLIFOS[i]` mapeia direto.
    """
    alt = 48
    largura = max(8, int(recorte.width * alt / recorte.height))
    largura = (largura + 7) // 8 * 8
    r = recorte.resize((largura, alt), Image.BILINEAR)
    a = np.asarray(r, dtype=np.float32)[:, :, ::-1].transpose(2, 0, 1) / 255.0
    a = (a - 0.5) / 0.5
    saida = sess.run(None, {"x": a[None]})[0][0]  # T x 838

    ids = [int(i) for i in saida.argmax(axis=1)]
    chars = []
    anterior = -1
    for i in ids:
        if i == 0:
            anterior = -1  # blank quebra a repeticao
            continue
        if i != anterior and i < len(GLIFOS):
            chars.append(GLIFOS[i])
        anterior = i
    return "".join(chars), float(saida.max(axis=1).mean())


def main():
    det = sessao("PP-OCRv5_mobile_det.onnx")
    rec = sessao("latin_PP-OCRv5_mobile_rec.onnx")

    print(f"dicionario: {len(GLIFOS)} glifos")
    print(f"rec classes: {rec.get_outputs()[0].shape[-1]}\n")

    for p in obter_prINTS():
        img = Image.open(p).convert("RGB")
        print(f"=== {p.name}  {img.width}x{img.height} ===")
        caixas = detectar(det, np.asarray(img))
        print(f"  caixas: {len(caixas)}")
        for (x0, y0, x1, y1) in caixas:
            rec_ = img.crop((x0, y0, x1, y1))
            texto, conf = reconhecer(rec, rec_)
            print(f"  [{conf:.3f}] {texto!r}")


if __name__ == "__main__":
    main()
