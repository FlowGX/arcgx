import collections
import json
from pathlib import Path

d = json.loads(Path(r"H:\Arcgxapp\dados\game\items.json").read_text(encoding="utf-8"))
its = list((d.get("items") or {}).values())
print("total:", len(its))
print("campos:", sorted(its[0].keys()))
print()
for chave in ("rarity", "rarityName", "tier", "grade", "color"):
    vals = [i.get(chave) for i in its if i.get(chave) is not None]
    if vals:
        print(chave, "->", collections.Counter(map(str, vals)).most_common(12))
print()
print("exemplo:", json.dumps(its[0], ensure_ascii=False, indent=2)[:600])