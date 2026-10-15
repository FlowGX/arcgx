"""Roda o contador de raid sobre as capturas rotuladas.

Cada captura vira uma "raid": identifica as celulas rotuladas, soma o valor de
catalogo e compara com o gabarito — que aqui e a referencia. O medidor nao e
a soma em si, e sim **onde o total erra**, porque a soma erra por cancelamento
e o detalhe nao.

Alem disso mostra o quanto do total sobrevive se a gente so olhar celulas em
que o modelo tem confianca. Sem isso, um total de 5.000 pode ser 20 itens
corretos mais 3 errados que se cancelam.
"""

import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))
spec = importlib.util.spec_from_file_location("raid", RAIZ / "ml" / "raid.py")
raid = importlib.util.module_from_spec(spec)
sys.modules["raid"] = raid
spec.loader.exec_module(raid)
ec = sys.modules["encoder_comum"]


def main():
    pesos = sys.argv[1] if len(sys.argv) > 1 else None
    c = raid.Contador(pesos=pesos)
    print(f"galeria: {len(c.ids)}   encoder: {ec.caminho_pesos().name}")
    print(f"filtro de raridade aplicado: {c.raridade_confiavel}")
    if c.avisos:
        print("avisos:")
        for a in c.avisos:
            print(f"  ! {a}")

    gab = json.loads((RAIZ / "dados" / "rotulo" / "gabarito.json").read_text(encoding="utf-8"))
    # ## `capturas.js`, e nao `capturas.json`
    #
    # O indice das capturas e `window.CAPTURAS`, gerado por
    # `tools/rotulo/exportar.mjs` para a pagina de rotulagem. Nao existe
    # `capturas.json` — o `ml/propor-rotulos.py` le o caminho errado desde o
    # comeco e so falhou agora por causa da lista de rotulos do gabarito ter
    # mascarado. Nao corrigi la porque o script ainda nao roda ponta a ponta.
    texto = (RAIZ / "dados" / "rotulo" / "capturas.js").read_text(encoding="utf-8")
    ini, fim = texto.index("["), texto.rindex("]")
    caps_lista = json.loads(texto[ini : fim + 1])
    nomes = {x["nome"]: x for x in caps_lista}

    acertos = total_cel = 0
    por_captura = []
    erros = Counter()

    for cap in sorted((gab.get("capturas") or {})):
        celulas = gab["capturas"][cap] or {}
        caminhos, verdade = [], []
        for k, item in celulas.items():
            if not item or item == "VAZIA":
                continue
            p = raid.RAIZ / "dados" / "rotulo" / "lote" / cap / f"{k}.png"
            if p.exists():
                caminhos.append(p)
                verdade.append(item)
        if not caminhos:
            continue

        r = c.total(caminhos)
        por_captura.append((cap, r["total"], len(caminhos)))

        for linha, gt in zip(r["detalhe"], verdade):
            total_cel += 1
            if linha["item"] == gt:
                acertos += 1
            else:
                erros[(gt, linha["item"])] += 1

    print(f"\ncelulas rotuladas avaliadas: {total_cel}")
    print(f"item correto              : {acertos} ({acertos / total_cel:.1%})")
    print(f"item errado               : {total_cel - acertos}")

    print(f"\ntotais por captura (10 primeiras de {len(por_captura)}):")
    for cap, tot, n in por_captura[:10]:
        print(f"  {cap:<30} {n:>2} celulas   {tot:>9,}")

    if erros:
        print("\nconfusoes mais comuns (gabarito -> previsto):")
        for (g, p), v in erros.most_common(10):
            print(f"  {g:<28} -> {p:<28} {v}")


if __name__ == "__main__":
    main()