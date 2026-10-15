"""
Latencia real do caminho de scan: um recorte -> nome de item.

## Por que este numero decide o desenho

A captura entrega ~20 celulas por quadro de inventario, e o arc tracker
responde "quase imediato". Isso so funciona com o caminho todo em **milissegundos**,
na CPU — sem GPU, sem modelo grande, e sem esperar Accumular.

O que este script mede, com o encoder que hoje existe (`encoder-arte.pt`,
treinado sem nenhum rotulo):

1. quanto custa codificar **um** recorte, em CPU
2. quanto custa codificar os 1.106 itens da galeria, uma vez
3. quanto custa a busca depois disso

O passo 2 e o que muda o desenho: se a galeria inteira fosse re-codificada a
cada quadro, nao ha como chegar a "imediato". Mas ela **nao muda** — o catalogo
e estatico. Entao o caminho por quadro e so: 20 encodes + uma busca de
20 x 1.106. Se isso cabe em poucos milissegundos, o desenho de "banco interno"
funciona e nao existe necessidade de rotular item por item.
"""

import time

import numpy as np
import onnxruntime as ort
from PIL import Image

MODELO = r"H:\Arcgxapp\ml\modelo\encoder-arte.onnx"
GALERIA = r"H:\Arcgxapp\dados\rotulo\cache-arte"
EXEMPLO = r"H:\Arcgxapp\dados\rotulo\lote"


def main():
    sess = ort.InferenceSession(MODELO, providers=["CPUExecutionProvider"])
    entrada = sess.get_inputs()[0].name
    print(f"entradas: {[i.name for i in sess.get_inputs()]}")
    print(f"saidas  : {[o.name for o in sess.get_outputs()]}")

    dummy = np.random.rand(1, 3, 112, 112).astype(np.float32)

    # aquecimento: a primeira chamada paga o custo de inicializacao do runtime
    for _ in range(5):
        sess.run(None, {entrada: dummy})

    N = 300
    t0 = time.perf_counter()
    for _ in range(N):
        sess.run(None, {entrada: dummy})
    por_recorte = (time.perf_counter() - t0) / N * 1000

    # lote de 20 = um quadro de inventario
    lote = np.random.rand(20, 3, 112, 112).astype(np.float32)
    for _ in range(5):
        sess.run(None, {entrada: lote})
    t0 = time.perf_counter()
    for _ in range(N):
        sess.run(None, {entrada: lote})
    por_grade = (time.perf_counter() - t0) / N * 1000

    # busca: 20 vetores contra 1106
    q = np.random.rand(20, 256).astype(np.float32)
    g = np.random.rand(1106, 256).astype(np.float32)
    t0 = time.perf_counter()
    for _ in range(N):
        _ = q @ g.T
    por_busca = (time.perf_counter() - t0) / N * 1000

    print()
    print(f"1 recorte            : {por_recorte:>6.2f} ms")
    print(f"20 recortes (grade)   : {por_grade:>6.2f} ms")
    print(f"busca 20 x 1106      : {por_busca:>6.3f} ms")
    print(f"-" * 34)
    print(f"por quadro de inventario: {por_grade + por_busca:>5.2f} ms")
    print(f"em 60 fps (16,7 ms)  : {'cabe' if por_grade + por_busca < 16.7 else 'nao cabe'}")
    print()
    print("A galeria e ESTATICA: o catalogo nao muda entre quadros.")
    print("Codificar as 1.106 artes custa uma unica vez, no arranque:")


def custo_inicial():
    sess = ort.InferenceSession(MODELO, providers=["CPUExecutionProvider"])
    entrada = sess.get_inputs()[0].name
    bloco = np.random.rand(128, 3, 112, 112).astype(np.float32)
    sess.run(None, {entrada: bloco[:1]})
    t0 = time.perf_counter()
    for i in range(0, 1024, 128):
        sess.run(None, {entrada: bloco})
    dt = time.perf_counter() - t0
    print(f"codificar 1.024 itens em CPU: {dt:.2f} s  (=> 1.106 em ~{dt * 1106 / 1024:.2f} s)")


if __name__ == "__main__":
    main()
    custo_inicial()