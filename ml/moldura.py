"""
Opcao 2: renderiza a arte do catalogo DENTRO da mesma moldura do jogo.

## O problema que este modulo resolve

A sonda mostrou que o encoder le a moldura, nao o objeto:

    crops de itens DIFERENTES   coseno mediano 0,398
    crop <-> arte do item certo coseno mediano 0,286

O recorte do jogo e a arte do catalogo nao vivem no mesmo dominio. De um
lado: celula escura, cunha de raridade saturada no canto inferior esquerdo,
barra inferior com icone e quantidade. Do outro: o sprite isolado, com fundo
transparente. O encoder tem 1.106 "negaativos" para aprender a separar e nao
consegue, porque as duas entradas so se parecem no objeto — que ocupa uma
fracao pequena da imagem — e nao no resto.

Treinar `recorte` contra `arte pura` deixa o modelo的手 escolha: ou ignora a
moldura e vira um detector de raridade, ou casa por posicao.

## A solucao

Desenhar a arte dentro de uma celula com a mesma moldura: fundo escuro, a
mesma cunha de raridade **na cor daquele item**, a mesma barra inferior. A
partir dai o unico delta entre as duas entradas e o proprio objeto, que e o
que o encoder precisa codificar.

## As cores nao sao chutadas

A cunha e pintada com a cor medida nos propios recortes rotulados, agrupados
pela raridade do catalogo. Se o jogo mudar o paleta, a medicao muda junto.

## Medidas que sustentam a geometria

Vem de `ml/medir-moldura.py` (variancia por indice de celula) e da grade
desenhada em `ml/grade-celula.py`:

    celula              92 x 104
    sprite do item      x 6..88,  y 8..86
    cunha de raridade   triangulo (0,50) (0,86) (46,86)
    barra inferior      y 86..104
    borda superior      y 0..8
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAIZ = Path(r"H:\Arcgxapp")

# --- geometria medida (nao ajustar sem re-medir)
CELULA_W, CELULA_H = 92, 104
ITEM_X0, ITEM_X1 = 6, 88
ITEM_Y0, ITEM_Y1 = 8, 86
CUNHA = [(0, 50), (0, 86), (46, 86)]
BARRA_Y = 86

# ## Por que esta janela e pequena e rente ao canto

# A cunha e o triangulo (0,50)-(0,86)-(46,86): a diagonal sobe da esquerda
# para a direita, e o interior e **abaixo** dela. A primeira versao media
# (3,62)-(30,84), que e boa parte *acima* da diagonal — ou seja, fundo. O
# resultado foi Epic e Amplified saindo magenta (sao as unicas classes com
# cunha grande) e as outras quatro caindo em azuis escuros: a paleta estava
# sendo medida do lugar errado, nao do objeto.
#
# Para guaranteeing que a janela esta dentro da cunha, o canto inferior
# esquerdo e o unico lugar seguro: a 25 px da borda, a diagonal ja passou de
# y=69, entao 75..84 esta inteiro dentro.
AMOSTRA_CUNHA = (3, 75, 25, 84)

# a barra tem icone (x ~2..18) e quantidade (x ~60..86). A arte nao tem
# quantidade nenhuma, entao esse trecho e apagado dos dois lados: se ficasse
# so no recorte, viraria pista falsa de classe.
BARRA_ICONE = (0, 19)
BARRA_QUANT = (56, 92)


def carregar_catalogo():
    d = json.loads((RAIZ / "dados" / "game" / "items.json").read_text(encoding="utf-8"))
    itens = (d.get("items") or {}).values()
    return {i["id"]: i for i in itens if i.get("imageFilename")}


def carregar_gabarito():
    return json.loads((RAIZ / "dados" / "rotulo" / "gabarito.json").read_text(encoding="utf-8"))


def recortes_rotulados(lote):
    """-> [(caminho, item_id)]"""
    gab = carregar_gabarito()
    out = []
    for cap, celulas in (gab.get("capturas") or {}).items():
        for idx, item in (celulas or {}).items():
            if not item or item == "VAZIA":
                continue
            p = lote / cap / f"{idx}.png"
            if p.exists():
                out.append((p, item))
    return out


def fundo_dominante(arr):
    """
    Cor de fundo da celula: a cor que mais aparece no template.

    A mediana pixel a pixel de 324 itens diferentes apaga o sprite, mas nao
    limpa — vira uma borra marrom no meio da celula, visivel em
    `moldura-previa.png`. Como o fundo e chapado e ocupa a maior parte da
    celula, a cor mais frequente do template e ele.

    Contar cores exatas seria sensivel ao ruido do compressor, entao a
    contagem e feita em canais quantizados (>>4, ou seja, passos de 16) e o
    centro do bloco vencedor e usado como cor.
    """
    q = (arr.reshape(-1, 3).astype(np.int32) >> 4)
    chave = q[:, 0] * 4096 + q[:, 1] * 64 + q[:, 2]
    vals, cont = np.unique(chave, return_counts=True)
    vencedor = vals[int(cont.argmax())]
    alvo = np.array([(vencedor >> 12) & 15, (vencedor >> 6) & 15, vencedor & 15], dtype=np.float32)
    # refina com a media dos pixels do bloco vencedor, para nao ficar no
    # centro quantizado
    mask = chave == vencedor
    return arr.reshape(-1, 3)[mask].mean(axis=0)


def template_base(lote):
    """
    Celula sem item: mediana de todos os recorte8.

    A mediana pixel a pixel de itens diferentes mantem o fundo (identico em
    todos) e apaga o sprite e a cunha (que mudam). Serve de base para a
    renderizacao.
    """
    pares = recortes_rotulados(lote)
    arr = np.stack([np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) for p, _ in pares])
    med = np.median(arr, axis=0)
    base = med.copy()
    cor = fundo_dominante(med)
    # mata a borra do sprite, mas preserva a borda superior e a barra: as
    # duas existem igual dos dois lados, entao sao constante, nao ruido
    base[ITEM_Y0:ITEM_Y1, ITEM_X0:ITEM_X1, :] = cor
    return Image.fromarray(base.clip(0, 255).astype(np.uint8)), arr


def cores_raridade(cat, lote):
    """
    Cor de cada raridade, medida nos recorte8 rotulados.

    Agrupa por `rarity` do catalogo e mede a mediana da regiao interna da
    cunha. Medir em vez de chutar importa: a paleta e do renderizador do
    jogo e nao segue os nomes.

    ## Quando a medicao nao serve

    Devolve tambem `{raridade: n_amostras}`. Uma cor medida com poucas
    amostras nao e uma cor — e uma suposicao de uma amostra. O caso real:
    Amplified tem 93 itens no catalogo e **1** recorte rotulado, e a cor
    medida saiu identica a do Epic (rgb 204,48,153). Um filtro de raridade que
    confunda Amplified com Epic nao erra de forma visivel: ele simplesmente
    aceita o item errado. Por isso quem chama tem de ver o `n`.
    """
    x0, y0, x1, y1 = AMOSTRA_CUNHA
    por_classe = defaultdict(list)
    for p, item in recortes_rotulados(lote):
        info = cat.get(item)
        if not info:
            continue
        a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)[y0:y1, x0:x1]
        por_classe[info.get("rarity") or "?"].append(np.median(a.reshape(-1, 3), axis=0))

    paleta = {}
    for raridade, amostras in por_classe.items():
        paleta[raridade] = tuple(int(v) for v in np.median(np.stack(amostras), axis=0))
    contagem = {r: len(a) for r, a in por_classe.items()}
    return paleta, contagem


def auditar_paleta(paleta, contagem, minimo=5, fundo=None, tol_fundo=30):
    """
    Erros que a paleta **nao** pode ter, e que sao silenciosos.

    Tres coisas:

    1. **Pouca amostra.** Abaixo de `minimo` recorte8 a cor e ruido. O caso
       do Amplified: 1 recorte.

    2. **Colisao.** Duas raridades com a mesma cor nao sao distinguiveis pelo
       filtro de raridade, que e justamente o segundo estagio do scan ao vivo.
       Isso nao da erro nenhum — so faz o filtro aceitar o item errado.

    3. **Cunha invisivel.** Uma raridade cuja cunha sai com a cor do fundo da
       celula e, para o filtro, igual a celula vazia. Isso passa pelas duas
       verificacoes acima: tem amostra suficiente e nao colide com ninguem —
       porque a cor errada e a cor que nao existe. Precisa do fundo como
       referencia, que e por isso que `fundo` entra aqui.

    Retorna a lista de avisos. Vazia significa palette utilizavel.
    """
    avisos = []
    for r, n in sorted(contagem.items()):
        if n < minimo:
            avisos.append(
                f"raridade {r}: so {n} recorte(s) rotulado(s) "
                f"(minimo {minimo}) — cor nao confiavel"
            )
    for a in sorted(paleta):
        for b in sorted(paleta):
            if a >= b:
                continue
            va, vb = np.array(paleta[a], float), np.array(paleta[b], float)
            d = float(np.linalg.norm(va - vb))
            if d < 24:
                avisos.append(
                    f"colisao: {a} {tuple(paleta[a])} e {b} {tuple(paleta[b])} "
                    f"sao quase a mesma cor (dist {d:.1f}) — filtro de raridade nao separa"
                )
    if fundo is not None:
        vf = np.array(fundo, float)
        for r in sorted(paleta):
            d = float(np.linalg.norm(np.array(paleta[r], float) - vf))
            if d < tol_fundo:
                avisos.append(
                    f"raridade {r}: cunha {tuple(paleta[r])} fica a {d:.1f} do fundo "
                    f"{tuple(int(v) for v in fundo)} — para o filtro e indistinguivel de celula vazia"
                )
    return avisos


def _barra_neutra(base_arr):
    """Barra inferior sem icone e sem quantidade."""
    out = base_arr.copy()
    barra = out[BARRA_Y:, :, :]
    # a barra e quase uniforme; usa a mediana dela como cor de preenchimento
    cor = np.median(barra.reshape(-1, 3), axis=0)
    for x0, x1 in (BARRA_ICONE, BARRA_QUANT):
        out[BARRA_Y:, x0:x1, :] = cor
    return out


def _desenhar_cunha(arr, cor):
    out = Image.fromarray(arr.astype(np.uint8))
    d = ImageDraw.Draw(out)
    d.polygon(CUNHA, fill=tuple(int(c) for c in cor))
    return np.asarray(out, dtype=np.float32)


def enquadrar_arte(arte, cor_arco, base_arr):
    """
    Desenha a arte do catalogo na celula, com cunha de raridade e barra.

    A arte e escalada para caber na area do item preservando proporcao. Isso
    **perde a diferenca de tamanho real** entre um item pequeno e um grande: o
    modelo passa a ver todos os sprites ocupando a mesma area. Aceito de
    proposito — tamanho absoluto varia com o zoom da tela e seria ruido, e
    identidade vem da forma, nao do tamanho.
    """
    arr = _desenhar_cunha(_barra_neutra(base_arr), cor_arco)

    sprite = arte.convert("RGBA")
    caixa_w = ITEM_X1 - ITEM_X0
    caixa_h = ITEM_Y1 - ITEM_Y0
    escala = min(caixa_w / sprite.width, caixa_h / sprite.height)
    novo = (max(1, int(sprite.width * escala)), max(1, int(sprite.height * escala)))
    sprite = sprite.resize(novo, Image.LANCZOS)

    fundo = Image.fromarray(arr.astype(np.uint8)).convert("RGBA")
    camada = Image.new("RGBA", fundo.size, (0, 0, 0, 0))
    camada.paste(
        sprite,
        ((CELULA_W - novo[0]) // 2, (ITEM_Y0 + ITEM_Y1 - novo[1]) // 2),
        sprite,
    )
    return Image.alpha_composite(fundo, camada).convert("RGB")


def enquadrar_recorte(recorte, base_arr):
    """
    Aplica no recorte do jogo a mesma limpeza aplicada na arte.

    Apaga icone e quantidade da barra. Mantem a cunha: ela e informacao real
    do item e agora a arte tem a mesma cunha, entao as duas pontas combinam.
    """
    a = np.asarray(recorte.convert("RGB"), dtype=np.float32)
    a = _barra_neutra(a)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def arte_rgba(item):
    """
    Arte do catalogo em RGBA, no tamanho nativo.

    Diferente de `avaliar._arte`: aqui a transparencia importa, porque a arte
    vai ser **compositada** na celula. Redimensionar para um quadrado e
    jogar fora o alpha (como a avaliacao faz) destruiria exatamente o que este
    modulo precisa.

    A chave do cache e md5 da URL, como em `avaliar._arte`. O cache antigo,
    gravado por `gerar-vizinhos.py`, usa `abs(hash(url))` — e `hash()` e
    randomizado por processo, entao o nome nunca bate entre execucoes. Por
    isso o md5, e nao o cache herdado.
    """
    import hashlib
    import urllib.request

    url = item["imageFilename"]
    cache = RAIZ / "dados" / "rotulo" / "cache-arte"
    p = cache / f"{hashlib.md5(url.encode()).hexdigest()}.png"
    if not p.exists():
        try:
            cache.mkdir(parents=True, exist_ok=True)
            req = urllib.request.Request(url, headers={"User-Agent": "ArcGX/0.1"})
            with urllib.request.urlopen(req, timeout=20) as r:
                p.write_bytes(r.read())
        except Exception:
            return None
    try:
        return Image.open(p).convert("RGBA")
    except Exception:
        return None


class Moldura:
    """
    Reúne o que a renderização precisa: fundo, paleta de raridade e os dois
    lados do enquadramento.

    Existe como classe para o `treinar.py` montar uma vez e passar para a
    arte e para o recorte, garantindo que os dois usam o **mesmo** fundo e a
    **mesma** paleta. Se cada lado montasse o seu, a moldura voltaria a ser
    uma variável livre entre as duas entradas — que era o problema original.
    """

    def __init__(self, base_arr, paleta):
        self.base_arr = base_arr
        self.paleta = paleta

    def enquadrar_arte(self, arte, cor_arco, base_arr=None):
        return enquadrar_arte(arte, cor_arco, self.base_arr if base_arr is None else base_arr)

    def enquadrar_recorte(self, recorte):
        return enquadrar_recorte(recorte, self.base_arr)


def carregar_paleta(cat=None, lote=None, minimo=5):
    """
    Paleta de raridade **auditada**.

    Devolve `(Moldura, avisos)`. Quem chama deve imprimir os avisos: uma
    paleta com colisao ou pouca amostra nao pode passar em silencio, porque o
    filtro de raridade do scan ao vivo depende dela e falha em silencio.
    """
    cat = cat if cat is not None else carregar_catalogo()
    lote = lote if lote is not None else (RAIZ / "dados" / "rotulo" / "lote")
    base, _ = template_base(lote)
    paleta, contagem = cores_raridade(cat, lote)
    mold = Moldura(base_arr=np.asarray(base, dtype=np.float32), paleta=paleta)
    mold.contagem = contagem
    return mold, auditar_paleta(paleta, contagem, minimo)


def main():
    import importlib.util

    spec = importlib.util.spec_from_file_location("treinar", RAIZ / "ml" / "treinar.py")
    t = importlib.util.module_from_spec(spec)
    sys.modules["treinar"] = t
    spec.loader.exec_module(t)

    lote = t.LOTE
    cat = carregar_catalogo()
    base, _ = template_base(lote)
    paleta, contagem = cores_raridade(cat, lote)
    fundo = fundo_dominante(np.asarray(base, dtype=np.float32))

    print(f"base: {base.size}   fundo {tuple(int(v) for v in fundo)}")
    print("cores medidas por raridade:")
    for r, c in sorted(paleta.items()):
        print(f"  {r:<10} rgb{str(c):<18} n={contagem.get(r, 0)} recorte(s)")

    avisos = auditar_paleta(paleta, contagem, fundo=fundo)
    if avisos:
        print("\nAVISOS — a paleta acima NAO deve ser usada sem revisar:")
        for a in avisos:
            print(f"  ! {a}")
    else:
        print("\npaleta ok")

    base_arr = np.asarray(base, dtype=np.float32)

    # previa visual: arte enquadrada x recorte real, lado a lado
    ESC = 4
    colunas = []
    for raridade in sorted(paleta):
        alvo = next((i for i in cat.values() if i.get("rarity") == raridade), None)
        if not alvo:
            continue
        arte = arte_rgba(alvo)
        if arte is None:
            continue
        colunas.append((raridade, enquadrar_arte(arte, paleta[raridade], base_arr)))

    if not colunas:
        print("nenhuma arte para a previa")
        return

    H = CELULA_H * ESC
    linha = Image.new("RGB", ((CELULA_W * ESC + 8) * len(colunas), H), (12, 12, 12))
    for n, (raridade, im) in enumerate(colunas):
        linha.paste(im.resize((CELULA_W * ESC, H), Image.NEAREST), (n * (CELULA_W * ESC + 8), 0))
        print(f"  previa: {raridade}")
    destino = RAIZ / "dados" / "rotulo" / "moldura-previa.png"
    linha.save(destino)
    print(f"\n-> {destino}")


if __name__ == "__main__":
    main()