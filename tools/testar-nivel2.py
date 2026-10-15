"""
Reavalia o leitor de nivel com o ground truth corrigido.

## O erro do teste anterior

O teste tratava "sem sufixo no id" como nivel 1. Isso e verdade para a arte do
catalogo, mas **nao** para a tela.

O print e os recorte8 mostram duas situacoes distintas que o teste nao separava:

    arma com nivel  I      -> barra direita com o glifo "I"
    ferramenta/material   -> barra direita **vazia**

O `aphelion` nao tem sufixo (entao `nivel_do_id` devolve 1) e mesmo assim
mostra "I". A `dolabra` tambem nao tem sufixo e mostra **nada**. O teste
comparava as duas contra o mesmo template de nivel 1 — e por isso contava 52
erros que nao eram erro do leitor: era ground truth ambiguo.

A distincao que importa para o filtro nao e "nivel 1", e **"tem nivel?"**:

- glifo presente  -> o item tem nivel, e o glifo diz qual
- glifo ausente   -> o item nao tem conceito de nivel (ferramenta, material)
                    e nao deve ser filtrado por nivel nenhum

Por isso o leitor precisa devolver `None` para "sem glifo", e nao 1. Devolver 1
fazia o filtro tratar ferramenta como se fosse arma nivel I.

## O ground truth corrigido

Tem nivel quando: tem sufixo no id **ou** o `type` do catalogo e `Weapon`.
O print confirma: Renegado IV (Weapon) mostra "IV"; a dolabra, ferramenta, nao
mostra nada.
"""

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))
spec = importlib.util.spec_from_file_location("nivel", RAIZ / "ml" / "nivel.py")
nivel = importlib.util.module_from_spec(spec)
sys.modules["nivel"] = nivel
spec.loader.exec_module(nivel)

CAT = {}
for i in (json.loads((RAIZ / "dados" / "game" / "items.json").read_text(encoding="utf-8")).get("items") or {}).values():
    CAT[i["id"]] = i


def tem_nivel(item_id):
    info = CAT.get(item_id, {})
    if nivel.NIVEL_ID.search(item_id):
        return True
    return info.get("type") == "Weapon"


def main():
    templates, contagem = nivel.construir_templates()
    print("templates por nivel:")
    for n in sorted(templates):
        print(f"  nivel {n}: n={contagem[n]:>3}")

    pares = nivel.pares_rotulados()

    com_glifo = [(p, i) for p, i in pares if tem_nivel(i)]
    sem_nivel = [(p, i) for p, i in pares if not tem_nivel(i)]
    print(f"\ntem nivel (Weapon ou sufixo): {len(com_glifo)}")
    print(f"sem nivel (ferramenta/material): {len(sem_nivel)}")

    # --- grupo com nivel: o glifo tem que dizer o numero certo
    acertos = 0
    erros = Counter()
    for caminho, item in com_glifo:
        real = nivel.nivel_do_id(item)
        lido, _ = nivel.ler(caminho, templates)
        if lido == real:
            acertos += 1
        else:
            erros[(real, lido)] += 1
    print(f"\n=== itens COM nivel: {len(com_glifo)} ===")
    print(f"  acertou: {acertos}/{len(com_glifo)} = {acertos / len(com_glifo):.1%}")
    for (r, l), v in erros.most_common(6):
        print(f"    {r} -> {l}: {v}")

    # --- grupo sem nivel: o leitor tem que devolver None, nunca um numero
    acertos2 = 0
    errado2 = Counter()
    for caminho, item in sem_nivel:
        lido, _ = nivel.ler(caminho, templates)
        if lido is None:
            acertos2 += 1
        else:
            errado2[lido] += 1
    print(f"\n=== itens SEM nivel: {len(sem_nivel)} ===")
    print(f"  classificados como 'sem nivel': {acertos2}/{len(sem_nivel)} = {acertos2 / len(sem_nivel):.1%}")
    for l, v in errado2.most_common(6):
        print(f"    devolveu nivel {l}: {v}")

    total = len(com_glifo) + len(sem_nivel)
    geral = acertos + acertos2
    print(f"\n=== no total ===")
    print(f"  {geral}/{total} = {geral / total:.1%}")


if __name__ == "__main__":
    main()