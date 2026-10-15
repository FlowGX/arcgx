"""
Acha itens que existem nas duas fontes mas nao casam por id.

## Por que isso existe

`sentinel-part` (nosso) e `sentinel_firing_core` (do arctracker) sao o mesmo
item com nomes internos diferentes. O canonizador resolve hifen/underscore e
sufixo de tier, mas nao palavra trocada — e o item ficava sem traducao,
deixando o usuario parado diante de um nome que "nao existe".

Adivinhar por regex (`_part` -> `_firing_core`?) seria inventar correspondencia
e traduzir o item errado, que e pior que nao traduzir. O certo e **medir**:
compara o nome em ingles de cada lado e reporta onde bate e onde nao bate.
O mapa de apelidos que o canonizador usa sai dai, com motivo em cada linha.
"""

import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
CATALOGO = RAIZ / "dados" / "game" / "items.json"
API = "https://arctracker.io/api/items"

import importlib.util
import urllib.request

spec = importlib.util.spec_from_file_location("at", RAIZ / "tools" / "data-ingest" / "sources" / "arctracker.mjs")

# o fonte e .mjs; em vez de shim de JS, replicamos a normalizacao aqui — sao
# tres linhas, e manter duas implementacoes da MESMA regra seria o erro que a
# pagina de rotulagem ja cometia
def canonico(s):
    return str(s or "").replace("-", "_").lower()


def so_ascii(s):
    import unicodedata

    return "".join(
        c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn"
    )


def chave_nome(nome):
    """Nome em ingles normalizado, para comparar identidade e nao id."""
    return re.sub(r"[^a-z0-9]+", " ", so_ascii(nome or "").lower()).strip()


def principal():
    req = urllib.request.Request(API, headers={"User-Agent": "ArcGX/0.1"})
    dados = json.loads(urllib.request.urlopen(req, timeout=60).read())
    at = dados["items"]

    nosso = json.loads(CATALOGO.read_text(encoding="utf-8"))["items"]

    # indice por nome em ingles na fonte
    por_nome = {}
    for i in at:
        k = chave_nome(i["name"].get("en"))
        if k:
            por_nome.setdefault(k, i)

    casados = nao_casados = sem_encontrar = 0
    apelidos = []

    for id_nosso, item in nosso.items():
        nome_en = (item.get("name") or {}).get("en")
        if not nome_en:
            continue
        c = canonico(id_nosso)
        # ja casa por id?
        if any(a.get("id", "").lower() == c for a in at):
            casados += 1
            continue
        # ou pelo apelido ja mapeado
        achou_id = False
        for a in at:
            if a["id"].lower() == c:
                achou_id = True
                break
        if achou_id:
            casados += 1
            continue

        k = chave_nome(nome_en)
        alvo = por_nome.get(k)
        if alvo:
            nao_casados += 1
            apelidos.append((id_nosso, alvo["id"], nome_en, alvo["name"].get("pt-BR")))
        else:
            sem_encontrar += 1

    print(f"itens no catalogo: {len(nosso)}")
    print(f"  casam por id    : {casados}")
    print(f"  casam por NOME  : {nao_casados}   <- precisam de apelido")
    print(f"  nenhum lado tem  : {sem_encontrar}\n")

    if apelidos:
        print("apelidos a adicionar em APELIDOS:\n")
        for a, b, en, pt in apelidos:
            print(f'  "{a}": "{b}",')
            print(f"      en: {en}   pt: {pt}")


if __name__ == "__main__":
    principal()