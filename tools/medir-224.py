"""
Latencia do encoder a 224, e o que da para ganhar.

## ## Por que a resolucao e o gargalo

`scan-worker.js` do ARC Tracker monta `[N, 224, 224, 3]`. Nosso encoder
usava 112. Treinar a 224 levou o recall@1 de 50,3% para **63,0%** — a maior
ganho da sessao inteira, e veio so de pixels.

O preco e latencia: quadruplicar a area quadruplica o custo. A 112 eram
1,33 ms por recorte e 4,89 ms por grade de 20. A 224 sao ~4x. Numa grade de 20
celulas isso passa de ~100 ms, e o orcamento do ARC Tracker e
`ARC_CLASSIFY_TARGET_MS=80`.

Entao a pergunta nao e "224 funciona?" — funciona, e e melhor. A pergunta e
**como pagar a conta sem o micro-stutter que o usuario sentiu no ARC Tracker**.

## As tres medidas que interessam

1. **um recorte** — latencia de uma celula isolada
2. **grade de 20 em um lote** — o caso real. Chamar o ONNX 20 vezes custa
   20x o overhead de sessao; um lote de 20 paga o overhead uma vez. E o que
   o `ARC_CLASSIFY_MIN_BATCH` deles sugere que eles tambem fazem.
3. **int8 quantizado** — MobileNetV3 e dominado por convolucao depthwise,
   que quantiza bem. Se o erro de acuracia for pequeno, int8 e caminho
   gratis: ~4x menor em disco e bem mais rapido em CPU.

O que **nao** entra: GPU. O app roda com o jogo em primeiro plano, e o jogo
esta usando a VRAM. Disputa por ali produz exatamente o stutter que o usuario
quer evitar.
"""

import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

MODELOS = {
    "arte-224": Path(r"H:\Arcgxapp\ml\modelo\encoder-arte.onnx"),
}


def medir(sess, entrada, n=60):
    for _ in range(5):
        sess.run(None, entrada)
    t0 = time.perf_counter()
    for _ in range(n):
        sess.run(None, entrada)
    return (time.perf_counter() - t0) / n * 1000


def forma(sess, batch):
    return [batch if isinstance(d, str) else d for d in sess.get_inputs()[0].shape]


def main():
    for nome, caminho in MODELOS.items():
        if not caminho.exists():
            print(f"{nome}: ausente")
            continue
        sess = ort.InferenceSession(str(caminho), providers=["CPUExecutionProvider"])
        inp = sess.get_inputs()[0]
        print(f"\n=== {nome} ({caminho.stat().st_size / 1e6:.1f} MB) ===")
        print(f"entrada: {inp.name} {inp.shape}  ({inp.type})")

        forma1 = forma(sess, 1)
        for b in (1, 20):
            arr = np.random.rand(*forma(sess, b)).astype(np.float32)
            ms = medir(sess, {inp.name: arr})
            por_celula = ms / b
            print(f"  lote {b:>2}: {ms:>7.2f} ms   ({por_celula:.2f} ms/celula)")

        print(f"\n  orcamento do ARC Tracker (ARC_CLASSIFY_TARGET_MS): 80 ms")

        ## int8
        try:
            from onnxruntime.quantization import QuantType, quantize_dynamic

            q = caminho.with_name(caminho.stem + "-int8.onnx")
            quantize_dynamic(str(caminho), str(q), weight_type=QuantType.QInt8)
            qs = ort.InferenceSession(str(q), providers=["CPUExecutionProvider"])
            qinp = qs.get_inputs()[0]
            arr1 = np.random.rand(*forma(qs, 1)).astype(np.float32)
            ms1 = medir(qs, {qinp.name: arr1})
            arr20 = np.random.rand(*forma(qs, 20)).astype(np.float32)
            ms20 = medir(qs, {qinp.name: arr20})
            print(f"\n  int8 ({q.stat().st_size / 1e6:.1f} MB)")
            print(f"    1 cel : {ms1:>7.2f} ms")
            print(f"    20    : {ms20:>7.2f} ms  ({ms20 / 20:.2f} ms/celula)")
        except Exception as e:
            print(f"\n  int8 indisponivel: {e}")


if __name__ == "__main__":
    main()