"""Conta quantas celulas receberam proposta, por captura e no total."""

import json
import re
from pathlib import Path

RAIZ = Path(r"H:\Arcgxapp")
txt = (RAIZ / "dados" / "rotulo" / "propostas.js").read_text(encoding="utf-8")

prop = json.loads(re.search(r"window\.PROPOSTAS = (\{.*?\});\n", txt, re.S).group(1))
conf = json.loads(re.search(r"window\.CONFIANCA = (\{.*?\});\n", txt, re.S).group(1))

celulas = {k: v for k, v in prop.items() if not k.startswith("_")}
total = sum(len(v) for v in celulas.values())
print(f"capturas com proposta: {len(celulas)}")
print(f"celulas com proposta : {total}")

# cobertura por captura
for cap in sorted(celulas)[:8]:
    print(f"  {cap}: {len(celulas[cap])}/20")

# a proposta esta certa?只能用 ja rotulado
gab = json.loads((RAIZ / "dados" / "rotulo" / "gabarito.json").read_text(encoding="utf-8"))
certas = erradas = checadas = 0
for cap, d in celulas.items():
    rot = (gab.get("capturas") or {}).get(cap) or {}
    for k, item in d.items():
        if k in rot and rot[k] not in ("VAZIA", "", None):
            checadas += 1
            if rot[k] == item:
                certas += 1
            else:
                erradas += 1
print()
print(f"propostas sobre celulas JA rotuladas: {checadas}")
if checadas:
    print(f"  corretas: {certas} ({certas / checadas:.1%})   erradas: {erradas} ({erradas / checadas:.1%})")