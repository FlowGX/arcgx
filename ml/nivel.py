"""
Le o numeral romano do nivel, na barra inferior da celula.

## O problema que este modulo resolve

O encoder sozinho erra ~40%, e o erro nao esta espalhado: esta nos pares de
itens que sao quase a mesma imagem — `burletta-ii` e `burletta-iv` tem a arte
identica no catalogo. A unica diferenca na tela e o **numeral romano** no canto
direito da barra inferior.

Por muito tempo eu disse que esses pares eram indistinguiveis. Estava errado, e
pior: o meu proprio codigo apagava o sinal. Em `moldura.py`:

    BARRA_QUANT = (56, 92)   # eu chamei de "quantidade"

Essa janela e exatamente o numeral. `enquadrar_recorte` a preenchia com a cor
da barra, nos dois lados — e a结论 "indistinguivel" era a consequencia de um
erro meu, nao uma propriedade do problema.

## ## Por que este modulo le o recorte CRU

O leitor aqui abre o PNG **original**, sem passar por `enquadrar_recorte`.

Isso parece contradizer o paragrafo acima e nao contradiz. Sao dois usos
diferentes do mesmo pixel:

- **encoder**: precisa que recorte e arte estejam no mesmo dominio. A arte do
  catalogo nao tem numeral, entao mascara-la nos dois lados mantem o
  casamento. O encoder nao deve ver o numeral — ele tem outro trabalho.
- **filtro de nivel**: precisa do numeral. Le o arquivo cru, que nunca foi
  mexeido.

Apagar o numeral da arte e do recorte deixa os dois iguais. Apagar so do
recorte quebraria o encoder. Nenhum dos dois e apagado.

## A amplificacao fecha o problema

O usuarioResearch aponta que so **15 armas** tem nivel 5, e cada uma tem uma
raridade **fixa**. Isso e uma restricao deterministica, nao estatistica: com
raridade epica e nivel V, o candidado so pode ser `Bettina` ou `Hullcracker`.
A lista esta em `AMPLIFICAVEIS` e vira filtro antes mesmo da busca.
"""

import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
LOTE = RAIZ / "dados" / "rotulo" / "lote"
GABARITO = RAIZ / "dados" / "rotulo" / "gabarito.json"
CATALOGO = RAIZ / "dados" / "game" / "items.json"

# ## Onde o numeral esta
#
# Localizado por **diferenca**, nao por suposicao: `tools/mapa-nivel.py`
# compara a media das mascaras de nivel 4 contra as de nivel 1, e a diferenca
# marca exatamente o glifo. Medido: x 76..87, y 88..100.
#
# A primeira versao usou x 58..92 e acertou 81,1%, errando 53 recorte8 de
# nivel 1 como nivel 2 — a faixa a esquerda do glifo carrega a barra e o icone
# de tipo, e o suficiente de ruido para parecer um "II". Estreitar no glifo
# resolve.
REGIÃO = (74, 87, 90, 102)

# Abaixo disso nao ha glifo. Calibrado pela distribuicao real: as populacoes
# de nivel 1 — arma com "I" e ferramenta sem glifo — se separam por volta de
# 20 px de area.
AREA_MIN_GLYFO = 20

NIVEL_ID = re.compile(r"-(i|ii|iii|iv|v)$")
ROMANOS = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}

# As 15 armas que alcancam nivel 5, com a raridade **fixa** de cada uma.
# A lista e fechada: nao e "as armas comuns", e exatamente estas 15. Isso
# transforma o filtro de nivel em restricao deterministica — raridade epica
# mais nivel V deixa 2 candidatos, nao 120.
AMPLIFICAVEIS = {
    "common": ["kettle", "hairpin", "rattler"],
    "uncommon": ["burletta", "il-toro"],
    "rare": ["anvil", "canto", "osprey", "rascal", "renegade"],
    "epic": ["bettina", "hullcracker"],
    "legendary": ["aphelion", "equalizer", "jupiter"],
}


def nivel_do_id(item_id):
    """`burletta-iv` -> 4. Sem sufixo -> 1."""
    m = NIVEL_ID.search(item_id or "")
    return ROMANOS[m.group(1)] if m else 1


def amplificavel(item_id):
    """A arma base e uma das 15 amplificaveis?"""
    base = NIVEL_ID.sub("", item_id or "")
    for lista in AMPLIFICAVEIS.values():
        if base in lista:
            return True
    return False


def mascara_numeral(caminho):
    """
    Recorta a regiao do numeral e devolve uma mascara binaria.

    ## Por que nao um limiar absoluto

    A primeira versao usava `lum > 128` e dava area **zero** para os niveis
    2 e 4 — 13,1% de acerto. `tools/medir-luminancia.py` mediu o porque:

        fundo da barra  : mediana 15, sempre
        glifo do numeral : 59 a 237, **conforme a raridade**

    A barra inferior muda de cor com a raridade da cunha. Num item Uncommon o
    numeral sai com luminancia 103; num Common, 237. Um limiar em 128 —
    escolhido no olho — fica acima do glifo inteiro em metade das raridades.
    Nao era coordenada errada: era contraste medido errado.

    ## Os dois polos

    Common tem barra clara e o numeral escuro nela. So `lum > fundo` perderia
    esses itens. Por isso a mascara e o **modulo** da distancia a mediana
    local: pega claro-sobre-escuro e escuro-sobre-claro com a mesma regra.
    """
    im = Image.open(caminho).convert("RGB").crop(REGIÃO)
    lum = np.asarray(im, dtype=np.float32).mean(axis=2)
    fundo = float(np.median(lum))
    return (np.abs(lum - fundo) > max(18.0, fundo * 0.55)).astype(np.float32)


def area(mascara):
    return float(mascara.sum())


def pares_rotulados():
    """[(caminho, item_id)] de todas as celulas rotuladas."""
    gab = json.loads(GABARITO.read_text(encoding="utf-8"))
    out = []
    for cap, celulas in (gab.get("capturas") or {}).items():
        for k, item in (celulas or {}).items():
            if item and item != "VAZIA":
                p = LOTE / cap / f"{k}.png"
                if p.exists():
                    out.append((p, item))
    return out


def construir_templates(minimo=3):
    """
    Monta a media da mascara por nivel, a partir dos recorte8 rotulados.

    ## Por que media e nao template exato

    A captura real tem ruido de compressao, e o mesmo numeral aparece em
    centenas de capturas com passaradas diferentes de JPEG. A media de todas
    as amostras do nivel converge para a forma do glifo e cancela o ruido,
    enquanto um recorte unico traria o ruido junto. Por isso `minimo` de 3:
    com menos que isso a "media" e um recorte so, com o nome de media.

    ## Niveis sem amostra

    Se o gabarito nao tiver recorte de nivel III, nao existe template para
    ele — e `auditar` avisa. Nao se inventa template de III a partir de II:
    o glifo e literalmente diferente, e um template chuteado erraria em
    silencio.
    """
    acc = {}
    for caminho, item in pares_rotulados():
        n = nivel_do_id(item)
        acc.setdefault(n, []).append(mascara_numeral(caminho))

    templates = {n: np.mean(np.stack(v), axis=0) for n, v in acc.items()}
    contagem = {n: len(v) for n, v in acc.items()}
    return templates, contagem


def auditar(contagem, minimo=3):
    """Niveis sem amostra suficiente — ler esses vai errar em silencio."""
    avisos = []
    for n in (1, 2, 3, 4, 5):
        if contagem.get(n, 0) < minimo:
            avisos.append(
                f"nivel {n}: {contagem.get(n, 0)} recorte(s) (minimo {minimo}) — "
                f"sem template confiavel"
            )
    return avisos


def ler(caminho, templates):
    """
    Le o nivel de um recorte.

    Devolve `(nivel, similaridade)`, ou `(None, 0.0)` quando nenhum template
    chega perto. Devolver `None` em vez de chutar e o ponto: um chute aqui
    vira um filtro que descarta o item certo.

    ## O portao de area vem antes dos templates

    Sem glifo **nao e** nivel 1. E "nao tem nivel": ferramenta, material e
    componente nao tem conceito de nivel, e a barra direita fica vazia.
    Confundir as duas coisas faz o filtro tratar uma broca como se fosse uma
    arma de nivel I — e descartar o proprio item.

    O teste antigo media "acertou o nivel" contra um ground truth que chamava
    de nivel 1 todo item sem sufixo no id. Isso e verdade na arte do
    catalogo e falso na tela: `aphelion` nao tem sufixo e **mostra "I"**,
    `dolabra` nao tem sufixo e **nao mostra nada**. Ver `tools/testar-nivel2.py`.

    Devolver `None` e o comportamento certo: o filtro de nivel nao se aplica
    a quem nao tem nivel, em vez de se aplicar a um numero adivinhado.
    """
    m = mascara_numeral(caminho)
    if area(m) < AREA_MIN_GLYFO:
        return None, 0.0
    if not templates:
        return None, 0.0
    melhor, melhor_sim = None, 0.0
    for n, t in templates.items():
        d = np.abs(m - t).mean()
        sim = 1.0 - float(d)
        if sim > melhor_sim:
            melhor, melhor_sim = n, sim
    return melhor, melhor_sim