"""
Le numeros da tela por template de digito, nao por OCR.

## ## Por que nao o PaddleOCR

O `rec` do PaddleOCR leu `24A977` com confianca **0,994** de uma imagem onde o
numero, nitido e grande, era `139.866`. Nao foi bug de recorte nem de
parametro: foi o modelo. E e o modo de falha ja registrado em
`ml/DIAGNOSTICO-OCR.md` — leitura falsa com confianca alta, que **nao se
detecta por limiar**, porque a confianca e alta justamente quando o erro e pior.

Numero grande, fonte fixa e conjunto fechado de 10 simbolos: template vence.

## ## Por que isso substitui a soma por item

`ml/contar-live.py` somou 39.600 contra 139.866 porque contou cada pilha como
uma unidade, quando o card diz "x80". A quantidade do card e um numero
**curto**, com o "x" colado no primeiro digito, em ~20 px: o caso dificil.

O total do cabecalho e um numero **longo**, com separador de milhar, em ~28 px,
sem prefixo grudado. E ele ja vem com acessorios e desgaste, que o catalogo nao
tem. Ler o total direto resolve o problema que a soma por item criou.

## ## ## ## O ponto e uma celula como qualquer outra

Os digitos de "139.866" formam **um unico run continuo** — nao ha coluna vazia
entre eles, e componente conectado nao separa. A primeira tentativa descartava
glifos baixos achando que isolaria o ponto; nao isola, porque o ponto esta
**colado** nos vizinhos.

A solucao e deixar de tentar separar o ponto: numa fonte monoespacada ele
ocupa uma **celula** do mesmo tamanho do digito. Entao o numero tem 7 celulas
(`1 3 9 . 8 6 6`), e fatiar em 7 funciona igual.

O preco e que o gabarito precisa contar o separador. E o ganho e que a
calibracao do ponto sai **de graca** — ele e mais um caractere rotulado
automaticamente, sem ninguem precisar dizer "esse aqui e ponto".
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
BIBLIOTECA = RAIZ / "dados" / "rotulo" / "digitos-templates.json"
CAPTURAS = Path(r"H:\Arcgxapp-ref\captures")

# ## Regioes com o gabarito do lado, **contando o separador**
#
# As caixas comecam depois do icone da moeda (ver `tools/ver-regioes.png`).
# ## ## ## A caixa tem de caber o numero mais CURTO
#
# O valor e alinhado a direita, entao um numero de 6 caracteres comeca mais a
# A caixa tem de caber o numero mais CURTO, porque o valor e alinhado a
# direita e um numero de 6 caracteres comeca mais a direita que um de 7.
#
# MAS: nem x=952 (cortava o "1" de "10.390") nem x=944 resolveram. A caixa
# estava pegando so a **cauda** do numero — em `mask-debug.png` o recorte
# comeca em "866", nao em "139.866". Medido pelo perfil de luminancia, o
# numero vai de x=918 a x=970.
#
# Por isso a regiao nao e mais escrita aqui: `caixa_de` deriva do frame.
NUMEROS_CONHECIDOS = [
    ("inventario-01.png", None, "10.390"),
    ("inventario-02.png", None, "139.866"),
    ("inventario-01.png", "armazenamento", "118.969"),
    ("inventario-02.png", "armazenamento", "131.206"),
]


def caixa_de(arquivo, rotulo=None, base=None):
    """
    Deriva a caixa do valor a partir do proprio frame.

    ## Aceita qualquer arquivo

    `base` deixa passar um frame ao vivo, e nao so as capturas de referencia.
    Sem isso, `ler-total-raid.py` so conseguiria ler os dois frames de
    calibracao — que e exatamente o teste que nao prova nada.

    O cabecalho do ARMAZENAMENTO tem o mesmo desenho do ARMAMENTO — peso,
    icone da moeda, valor — entao usa a mesma regra, com faixa e janela
    adaptadas ao painel da esquerda.
    """
    p = Path(arquivo)
    if base:
        p = Path(base) / Path(arquivo)
    if rotulo == "armazenamento":
        ## Janela 240..360, medida: o valor de ARMAZENAMENTO esta em
        ## x 266..318, e a janela antiga (180..520) invadia o painel do meio,
        ## onde ha outros numeros — e pegava o bloco errado, a 494..520.
        return faixa_do_valor(p, faixa_y=(166, 200), x0=240, x1=360)
    return faixa_do_valor(p)


def mascara_branca(caminho, box=None):
    """
    Texto claro sobre fundo escuro -> mascara binaria, por Otsu.

    ## ## Por que percentil falhou

    A primeira versao usava o percentil 92 da luminancia. Numa regiao de
    216x37, o texto ocupa uns 9% dos pixels — entao o percentil 92 cai **no
    meio do texto**, nao acima dele, e a mascara sao os pixels mais claros
    dentro dos glifos. O numero saia com a largura celular de 5,1 px em vez de
    15, e a fatiagem alinhava em 3 celulas onde havia 6.

    Percentil so funciona se a fracao de texto for conhecida e estavel. Aqui
    ela varia com o numero de digitos, entao varia a regiao.

    ## Por que Otsu

    A regiao e exatamente bimodal — fundo escuro, texto creme — e e o caso
    classico. Otsu escolhe o limiar que maximiza a variancia entre as duas
    classes, sem parametro nenhum. Custa uma varredura de 256 niveis.
    """
    im = Image.open(caminho).convert("L")
    if box:
        im = im.crop(box)
    a = np.asarray(im, dtype=np.uint8)

    hist = np.bincount(a.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    p = hist / total
    omega = np.cumsum(p)
    mu = np.cumsum(p * np.arange(256))
    mu_t = mu[-1]
    denom = omega * (1.0 - omega)
    with np.errstate(divide="ignore", invalid="ignore"):
        sigma_b = np.where(denom > 1e-12, (mu_t * omega - mu) ** 2 / denom, 0.0)
    t = int(np.argmax(sigma_b))
    return (a > t).astype(np.float32)


def faixa_do_valor(caminho, faixa_y=(168, 206), x0=640, x1=1320):
    """
    Acha a regiao do **valor** na linha do cabecalho do ARMAMENTO.

    ## ## ## ## Por que isto existe

    A versao anterior fixava a caixa em x=944 e a calibracao usava a MESMA
    caixa. Resultado: os dois lados concordavam e os quatro numeros de
    referencia davam 4/4 — mas a caixa so pegava a **cauda** do numero.

    Em `inventario-02.png` ela lia `866`, que e literalmente a parte que
    estava ali. E em `mask-debug.png` fica visivel: o recorte comeca em
    "866", nao em "139.866".

    Isso e a segunda vez nesta sessao que calibracao e teste usam a mesma
    premissa — a primeira foi o leitor de nivel, que ficou em 49,4% porque o
    "quem tem nivel" era um palpite meu em vez de um dado. Um 4/4 aqui
    provava que o codigo fazia o que eu mandava, nao que eu mandava a coisa
    certa.

    ## ## Como a regiao e achada

    A linha do cabecalho tem tres partes, nesta ordem:

        [peso]  [icone da moeda]  [valor]

    O peso e largo e tem "/" no meio. O icone e um simbolo unico, estreito e
    afastado do resto. O valor e a **ultima** mancha de tinta da linha.

    Entao: acham-se os blocos de tinta da faixa, e pega-se o ultimo que tiver
    largura suficiente para conter um numero. Isso funciona sem saber a
    posicao, e sem calibrar nada.

    O lado esquerdo do bloco pode estar cortado se o numero comecar antes de
    `x0`; por isso `x0` e generoso — a faixa toda do painel entra, e o que
    sobra e descartado pela regra do ultimo bloco.
    """
    im = Image.open(caminho).convert("L")
    escala = im.size[0] / 1920
    y0, y1 = int(faixa_y[0] * escala), int(faixa_y[1] * escala)
    a = np.asarray(im, dtype=np.uint8)
    faixa = a[y0:y1, int(x0 * escala) : int(x1 * escala)]

    hist = np.bincount(faixa.ravel(), minlength=256).astype(np.float64)
    p = hist / hist.sum()
    omega = np.cumsum(p)
    mu = np.cumsum(p * np.arange(256))
    mu_t = mu[-1]
    denom = omega * (1.0 - omega)
    with np.errstate(divide="ignore", invalid="ignore"):
        sigma = np.where(denom > 1e-12, (mu_t * omega - mu) ** 2 / denom, 0.0)
    mascara = faixa > int(np.argmax(sigma))

    cols = mascara.any(axis=0)
    brutos, dentro = [], False
    for x, v in enumerate(cols):
        if v and not dentro:
            ini, dentro = x, True
        elif not v and dentro:
            dentro = False
            brutos.append((ini, x))
    if dentro:
        brutos.append((ini, len(cols)))

    ## ## ## Juntar por proximidade, nao partir em qualquer coluna vazia
    #
    # A primeira versao partia em **qualquer** coluna vazia, e o recorte
    # devolvia 9 a 26 px — dois digitos, nao o numero.
    #
    ## Medido em `inventario-02.png` (perfil de luminancia, y 182..210):
    #
    #     (893,906)  gap 11   (918,919) (923,929) (932,939) (941,942) (945,970)
    #      icone     ^        1           3           9           .          866
    #                       ^ gap maximo DENTRO do numero = 3 px
    #
    # Entao `GAP` tem de separar 3 (interno) de 11 (icone). Valor 6 fica no
    ## meio com folga dos dois lados. Com 16 — o primeiro chute — o icone entra
    ## no numero e a caixa vira 184 px em vez de 53.
    GAP = 6
    blocos = []
    for b in brutos:
        if blocos and b[0] - blocos[-1][1] <= GAP:
            blocos[-1] = (blocos[-1][0], b[1])
        else:
            blocos.append(b)

    if not blocos:
        return None, None
    a0, a1 = blocos[-1]
    return (
        int(x0 * escala) + a0,
        y0,
        int(x0 * escala) + a1,
        y1,
    )


def _blocos(m, min_larg=2):
    """Runs de colunas com tinta."""
    cols = m.any(axis=0)
    saida, dentro = [], False
    for x, v in enumerate(cols):
        if v and not dentro:
            ini, dentro = x, True
        elif not v and dentro:
            dentro = False
            if x - ini >= min_larg:
                saida.append((ini, x))
    if dentro and len(cols) - ini >= min_larg:
        saida.append((ini, len(cols)))
    return saida


def extensao_da_linha(m):
    """Primeira e ultima coluna com tinta. (Ver `faixa_do_valor`.)"""
    cols = np.where(m.any(axis=0))[0]
    return (int(cols[0]), int(cols[-1])) if len(cols) else (None, None)


extensao = extensao_da_linha


def digitos_puros(m, frac_min=0.45):
    """Mantido so para diagnostico — ver `fatiar`, que e o caminho real."""
    runs = _blocos(m)
    if not runs:
        return []
    alturas = [int(m[:, a:b].any(axis=0).sum()) for a, b in runs]
    full = max(alturas)
    return [(a, b) for (a, b), h in zip(runs, alturas) if h >= full * frac_min]


def fatiar(m, celulas):
    """
    Fatia a mascara em `celulas` colunas de largura igual, da esquerda.

    `celulas` e quantos caracteres **deve** ter, contando o separador. E a
    trava: se a contagem nao bater, devolve lista vazia e o leitor responde
    `None` — em vez de um numero silenciosamente com um digito a menos, que e
    o modo de falha que a soma errada por quantidade teve.

    A extensao real da tinta e usada como inicio e fim, entao o espaco em
    volta do numero nao vira celula vazia no meio da fatia.
    """
    ini, fim = extensao(m)
    if ini is None:
        return []
    passo = (fim + 1 - ini) / celulas
    if passo < 2:
        return []
    return [
        m[:, int(ini + i * passo) : int(ini + (i + 1) * passo)] + 0.0
        for i in range(celulas)
    ]


# ## ## ## Celulas tem larguras diferentes: comparar truncado nao e comparar
#
# A primeira versao do `_dist` cortava as duas mascaras na largura menor:
#
#     float(np.abs(a[:h, :n] - b[:h, :n]).mean())
#
# Isso leu "118.969" como "118.961" com confianca **1,000** — confianca
# maxima num resultado errado. A causa: o "1" e um glifo de ~3 px, e o "9" de
# ~15 px; comparar so as 3 primeiras colunas do "9" (a haste esquerda do
# arco) com as 3 do "1" da uma diferenca pequena, e o casamento "perfeito" era
# entre duas coisas que nunca se pareceram.
#
# A correcao e normalizar as duas mascaras para o **mesmo tamanho** antes de
# comparar. A confianca volta a ter significado.
CANON = (18, 26)


def _dist(a, b):
    """Normaliza as duas mascaras para `CANON` e compara."""
    import numpy as _np

    def prep(m):
        h, w = m.shape
        # CANON e (largura, altura); o array e (altura, largura). Escrever
        # `zeros(CANON)` direto invertia os eixos e estourava o broadcasting.
        destino = _np.zeros((CANON[1], CANON[0]), dtype=_np.float32)
        # o glifo e desenhado **ancorado na base**: cortar pelo topo perde a
        # diferenca entre "1" (curto) e "9" (cheio), que e justamente o que
        # os distingue
        escala = CANON[1] / max(h, 1)
        ## `min(..., h)` e obrigatorio: o recorte de um digito de card tem
        ## ~20 linhas, e sem o clamp `m[:nh]` devolvia 18 linhas para um
        ## destino de 26 — `could not broadcast (18,18) into (26,18)`.
        nh = max(1, min(CANON[1], h, int(round(h * escala))))
        nw = max(1, min(CANON[0], w, int(round(w * escala))))
        y0 = CANON[1] - nh  # encosta na base
        x0 = (CANON[0] - nw) // 2
        destino[y0 : y0 + nh, x0 : x0 + nw] = _np.asarray(
            m, dtype=_np.float32
        )[:nh, :nw]
        return destino

    return float(_np.abs(prep(a) - prep(b)).mean())


def carregar():
    """Devolve (biblioteca, meta).

    ## ## Por que `_meta` virou um dicionario

    A primeira versao guardava a largura da celula num campo `_largura_celula`
    e a quantidade guardava a dela em `_largura_qtd` dentro do proprio dicionario
    de simbolos — que `salvar` filtra, porque remove tudo que comeca com `_`.
    O resultado era a largura da quantidade sumindo a cada gravacao, e o
    leitor cair em `TypeError` na leitura seguinte.

    Sao **duas medidas diferentes** (fonte de 28 px no cabecalho, ~20 px no
    card), entao cabe uma struct e nao duas variaveis soltas.
    """
    if not BIBLIOTECA.exists():
        return {}, {}
    bruto = json.loads(BIBLIOTECA.read_text(encoding="utf-8"))
    meta = bruto.pop("_meta", {})
    ## Tolera o formato antigo, que guardava `_largura_celula` como numero no
    ## topo. Sem este filtro, um arquivo gravado antes da mudanca quebra o
    ## carregamento com `'float' object is not iterable` — e o erro aponta
    ## para a lista de simbolos, que nao tem nada a ver.
    if "_largura_celula" in bruto:
        meta.setdefault("largura_celula", bruto.pop("_largura_celula"))
    simbolos = {
        k: [np.asarray(v, np.float32) for v in vs]
        for k, vs in bruto.items()
        if isinstance(vs, list)
    }
    return simbolos, meta


def n_celulas(m, largura_celula):
    """
    ## ## ## Por que uma so resposta nao basta

    A razao `extensao / largura_celula` da fracao certa so a cada 2 ou 3
    numeros: num frame novo ela pode dar 6,6 e arredondar para 7 quando o
    numero tem 6 caracteres. Em `ao-vivo-01.png` isso leu "1.309" de um
    "27.609" — com confianca 0,957.

    Entao sao candidatos, e o vencedor e o que **casa todas as celulas**. O
    `ler` ja devolve `None` quando uma celula nao bate com nenhum digito
    conhecido, entao testar 5, 6 e 7 e barato e o resultado errado nao passa
    pela trava.
    ##
    Se `largura_celula` nao for conhecida, devolve `None`.
    """
    if not largura_celula:
        return None
    ini, fim = extensao_da_linha(m)
    if ini is None:
        return None
    bruto = (fim + 1 - ini) / largura_celula
    return {max(1, int(bruto) - 1), max(1, int(bruto)), max(1, int(bruto) + 1)}


def ler_auto(m, larguras, bib, tol=0.17):
    """
    Le o numero testando as contagens de celula candidatas.

    Devolve `(texto, confianca, celulas)`. Vence a contagem em que **todas**
    as celulas casam com um digito conhecido. Empate vai para a confianca
    mais alta.
    """
    if not larguras:
        return None, 0.0, None
    melhor = None
    for celulas in sorted(larguras):
        txt, conf = ler(m, celulas, bib, tol)
        if txt is None:
            continue
        if melhor is None or conf > melhor[1]:
            melhor = (txt, conf, celulas)
    return melhor if melhor else (None, 0.0, None)


def salvar(bib, meta=None):
    """Grava a biblioteca. `meta` leva as medidas (larguras de celula)."""
    if not isinstance(meta, dict):
        meta = {"largura_celula": meta}
    BIBLIOTECA.parent.mkdir(parents=True, exist_ok=True)
    BIBLIOTECA.write_text(
        json.dumps(
            {
                "_meta": meta,
                **{
                    k: [v.tolist() for v in vs]
                    for k, vs in bib.items()
                    if not k.startswith("_")
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def ler(m, celulas, bib, tol=0.17):
    """
    Le os caracteres de uma mascara, um por celula.

    Devolve `(texto, confianca)` ou `(None, x)`. Preferir `None` a um numero
    errado e deliberado: um total inventado e pior do que nenhum, porque o
    usuario confiaria nele.
    """
    fatias = fatiar(m, celulas)
    if not fatias:
        return None, 0.0
    texto, pior = "", 0.0
    for f in fatias:
        melhor, dist = None, 1.0
        ## `ler` recebe a biblioteca inteira, e a mesma estrutura guarda as
        ## medidas em chaves com `_` (largura de celula do cabecalho e da
        ## quantidade). Sem este filtro, `masks` vira um float e o erro sai
        ## como `'float' object is not iterable`, longe da causa.
        for rot, masks in bib.items():
            if rot.startswith("_"):
                continue
            for ref in masks:
                d = _dist(f, ref)
                if d < dist:
                    melhor, dist = rot, d
        if melhor is None or dist > tol:
            return None, 1.0 - min(dist, 1.0)
        texto += melhor
        pior = max(pior, dist)
    return texto, 1.0 - pior


def como_numero(texto):
    """'139.866' -> 139866. O separador e de milhar, nao decimal."""
    if not texto:
        return None
    limpo = texto.replace(".", "").replace(",", "").replace(" ", "")
    return int(limpo) if limpo.isdigit() else None


def main():
    ## ## Calibra com os gabaritos
    #
    # Cada regiao tem o texto esperado ao lado, separador incluido. Entao
    # cada celula ganha o rotulo **so** — "139.866" vira 7 fatias rotuladas
    # 1, 3, 9, ., 8, 6, 6. O ponto entra na biblioteca sem ninguem precisar
    # rotular "este aqui e ponto".
    bib = {}
    usadas = 0
    larguras = []
    print("calibracao:")
    for arquivo, box, esperado in NUMEROS_CONHECIDOS:
        p = CAPTURAS / arquivo
        if not p.exists():
            continue
        m = mascara_branca(p, caixa_de(arquivo, box, base=CAPTURAS))
        fatias = fatiar(m, len(esperado))
        if not fatias:
            print(f"  {arquivo:<20} {esperado}: falhou ao fatiar em {len(esperado)} celulas")
            continue
        ini, fim = extensao(m)
        larguras.append((fim + 1 - ini) / len(esperado))
        for f, c in zip(fatias, esperado):
            bib.setdefault(c, []).append(f)
        usadas += 1
        print(f"  {arquivo:<20} {esperado}: ok ({len(esperado)} celulas)")

    largura_celula = float(np.median(larguras)) if larguras else None
    print(f"\nregioes usadas: {usadas}/{len(NUMEROS_CONHECIDOS)}")
    if largura_celula:
        print(f"largura da celula: {largura_celula:.1f} px  (monoespacada, "
              f"independe do numero de digitos)")
    faltando = set("0123456789") - set(bib)
    print("simbolos: " + "".join(sorted(bib)))
    if faltando:
        print("FALTANDO: " + "".join(sorted(faltando)) + "  (leitor devolve None para estes)")
    salvar(bib, {"largura_celula": largura_celula})
    print(f"-> {BIBLIOTECA}")

    print("\nreleitura com a biblioteca recem-criada:")
    acertos = 0
    for arquivo, box, esperado in NUMEROS_CONHECIDOS:
        p = CAPTURAS / arquivo
        if not p.exists():
            continue
        m = mascara_branca(p, caixa_de(arquivo, box, base=CAPTURAS))
        txt, conf, n = ler_auto(m, n_celulas(m, largura_celula), bib)
        ok = txt == esperado
        acertos += ok
        print(f"  {'ok ' if ok else 'ERR'} {esperado} -> {txt}  "
              f"conf {conf:.3f}  celulas {n}")
    print(f"\n{acertos}/{len(NUMEROS_CONHECIDOS)}")


if __name__ == "__main__":
    main()
