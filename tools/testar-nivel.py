"""Testa o leitor de nivel contra os recorte8 ja rotulados.

O gabarito tem o nivel verdadeiro em 324 recorte8. O leitor tem que acertar
contra esse numero — e nao contra uma media de acerto que esconda o caso
ruim. Por isso o relatorio mostra os erros, nao so a media.

Criterio: o gabarito e a unica fonte de nivel, e ele vem do `id` do catalogo
(`burletta-iv` -> 4). A medicao do leitor e independente disso.
"""

import importlib.util
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(r"H:\Arcgxapp")
sys.path.insert(0, str(RAIZ / "ml"))
spec = importlib.util.spec_from_file_location("nivel", RAIZ / "ml" / "nivel.py")
nivel = importlib.util.module_from_spec(spec)
sys.modules["nivel"] = nivel
spec.loader.exec_module(nivel)


def main():
    templates, contagem = nivel.construir_templates()
    print("templates por nivel (n = recorte8 rotulados):")
    for n in sorted(templates):
        print(f"  nivel {n}: n={contagem[n]:>3}   area media {nivel.area(templates[n]):>5.0f} px")

    avisos = nivel.auditar(contagem)
    if avisos:
        print("\nAVISOS:")
        for a in avisos:
            print(f"  ! {a}")
    print()

    acertos = erros = sem_nivel = 0
    por_nivel = Counter()
    errado_por_nivel = Counter()
    piores = []

    for caminho, item in nivel.pares_rotulados():
        real = nivel.nivel_do_id(item)
        lido, sim = nivel.ler(caminho, templates)
        por_nivel[real] += 1
        if lido is None:
            sem_nivel += 1
            continue
        if lido == real:
            acertos += 1
        else:
            erros += 1
            errado_por_nivel[(real, lido)] += 1
            if sim < 0.75:
                piores.append((sim, caminho.parent.name + "/" + caminho.name, item, real, lido))

    total = acertos + erros
    print(f"recortes rotulados: {total}")
    print(f"  acertou o nivel : {acertos:>4}  ({acertos / total:.1%})")
    print(f"  errou o nivel   : {erros:>4}  ({erros / total:.1%})")
    print(f"  sem template    : {sem_nivel:>4}")
    print()
    print("por nivel verdadeiro:")
    for n in sorted(por_nivel):
        e = errado_por_nivel.get((n, None), 0)
        err_n = sum(v for (r, l), v in errado_por_nivel.items() if r == n)
        print(f"  nivel {n}: {por_nivel[n]:>3} recortes, {err_n} erro(s)")

    if errado_por_nivel:
        print("\nconfusoes (real -> lido):")
        for (r, l), v in errado_por_nivel.most_common():
            print(f"  {r} -> {l}: {v}")

    if piores:
        print("\npiores (similaridade baixa, provavel regiao errada):")
        for sim, cap, item, real, lido in sorted(piores)[:8]:
            print(f"  sim {sim:.2f}  {cap:<28} {item:<22} {real} -> {lido}")


if __name__ == "__main__":
    main()