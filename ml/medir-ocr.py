"""
Mede o leitor de regioes nos frames coletados.

Roda em todos os frames, agrupa por regiao, e mostra a **variabilidade**: um
valor que muda frame a frame e leitura boa; um valor identico em 60 frames
provavelmente e o mesmo pixel lido de novo.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
PENDENTE = RAIZ / "dados" / "rotulo" / "pendente"
REGIOES = RAIZ / "dados" / "rotulo" / "regioes.json"
SAIDA = RAIZ / "dados" / "rotulo" / "ocr-leituras.json"

sys.path.insert(0, str(RAIZ / "ml"))
import importlib.util

_spec = importlib.util.spec_from_file_location("ocrreg", RAIZ / "ml" / "ocr-regioes.py")
_mod = importlib.util.module_from_spec(_spec)
# `@dataclass` le `sys.modules[cls.__module__].__dict__`. O importlib dinamico
# nao registra o modulo sozinho, e sem isso o decorator estoura com
# `AttributeError: 'NoneType' object has no attribute '__dict__'` — um erro que
# nao tem nada a ver com dataclass.
sys.modules["ocrreg"] = _mod
_spec.loader.exec_module(_mod)
LeitorOCR = _mod.LeitorOCR


def principal():
    regioes = json.loads(REGIOES.read_text(encoding="utf-8"))["regioes"]
    leitor = LeitorOCR.carregar()

    pastas = sorted(PENDENTE.glob("inv-*"))
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else len(pastas)
    pastas = pastas[:limite]

    acumulado = defaultdict(list)

    for pasta in pastas:
        meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
        raw = (pasta / "frame.raw").read_bytes()
        w, h = meta["frame"]["width"], meta["frame"]["height"]
        arr = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 4)
        img = Image.fromarray(np.dstack([arr[..., 2], arr[..., 1], arr[..., 0]]))

        for l in leitor.ler(img, regioes).leituras:
            acumulado[l.regiao].append((pasta.name, l))

    print(f"frames lidos: {len(pastas)}\n")
    total = 0
    resumo = {}

    for r in regioes:
        itens = acumulado.get(r["id"], [])
        total += len(itens)
        if not itens:
            print(f"{r['id']:22} peso {r['peso']}  sem leitura")
            continue

        valores = defaultdict(int)
        for _, l in itens:
            valores[f"{l.tipo}:{l.texto}"] += 1

        unicos = sorted(valores.items(), key=lambda kv: -kv[1])
        print(f"{r['id']:22} peso {r['peso']}  {len(itens):4} leituras  {len(unicos)} distintas")
        for v, n in unicos[:6]:
            print(f"    {n:4}x  {v}")
        resumo[r["id"]] = {v: n for v, n in unicos}

    print(f"\ntotal: {total} leituras em {len(pastas)} frames")
    SAIDA.write_text(json.dumps(resumo, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"-> {SAIDA}")


if __name__ == "__main__":
    principal()