"""
Contador de raid: o que voce tem, quanto vale, e o quanto disso ele tem certeza.

## Para que serve

O jogo mostra, no cabecalho do ARMAZENAMENTO, a soma dos valores da grade — no
print, `10 itens | 5.632`. Esse numero e um **ground truth de graca**: nao
precisamos inventar rotulo nem esperar o usuario marcar nada. Se a soma que
nosso codigo calcula bate com a da tela, a identificacao dos itens esta certa.
Se nao bate, a diferenca diz exatamente quanto erramos e em quais celulas.

E o motivo de esse passo vir antes de qualquer melhoria no encoder: ele
transforma "acho que 50% de acerto" em "a soma esta errada em 3.400" ou "bateu".

## O que este modulo NAO faz

Nao le valor da tela. Medimos que o card **nao** mostra valor — so icone de
tipo, quantidade e o numeral do nivel (`tools/ver-valor-card.py`). O valor
exato, com acessorios e desgaste, so aparece no tooltip do hover. Portanto:

    valor aqui = valor do CATALOGO, ou seja, base

Para o `renegade-iv` o catalogo diz 17.000 e a tela mostrava 24.525 com tres
acessorios equipados. A diferenca e dos mods, e nao de erro de identificacao.
Por isso a comparacao com o total da tela tem que ser feita **na mesma
base** — o total do catalogo contra uma comparacao sem mods, ou contra a
mesma condicao. Sem isso a diferenca mede os acessorios, nao a gente.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
LOTE = RAIZ / "dados" / "rotulo" / "lote"

sys.path.insert(0, str(ML))
spec = importlib.util.spec_from_file_location("encoder_comum", ML / "encoder_comum.py")
ec = importlib.util.module_from_spec(spec)
sys.modules["encoder_comum"] = ec
spec.loader.exec_module(ec)

import nivel as NIVEL  # noqa: E402


def carregar_catalogo():
    d = json.loads(ec.CATALOGO.read_text(encoding="utf-8"))
    return {i["id"]: i for i in (d.get("items") or {}).values()}


class Contador:
    """
    Identifica recorte e soma valor de catalogo.

    A galeria e codificada **uma vez** no arranque — `tools/medir-latencia.py`
    mediu 0,21 s para 1.106 itens. Por quadro sao so os encodes do recorte e
    uma busca, que e o que mantem o caminho em 4,89 ms.
    """

    def __init__(self, pesos=None, device=None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        if pesos:
            ec.PESOS = Path(pesos)
        self.modelo, self.device = ec.carregar_encoder(self.device)
        self.mold = ec.carregar_moldura()
        self.cat = carregar_catalogo()

        self.ids, self.gal = [], []
        for it in ec.carregar_itens():
            im = ec.arte_framed(it, mold=self.mold)
            if im is not None:
                self.ids.append(it["id"])
                self.gal.append(im)
        self.gal = ec.emb(self.gal, self.modelo, self.device)
        self.pos = {i: n for n, i in enumerate(self.ids)}

        self.templates_nivel, self.contagem_nivel = NIVEL.construir_templates()
        self.avisos = list(getattr(self.mold, "avisos", []) or [])
        self.avisos += NIVEL.auditar(self.contagem_nivel)

        # ## Amplified fica fora do filtro de raridade ate a paleta fechar
        #
        # A paleta mede Amplified com a mesma cor do Epic (dist 0,0), com uma
        # unica amostra. Filtrar por raridade nessa condicao nao e "impreciso":
        # e classificar 93 itens Amplified como Epic sem avisar. Melhor recusar
        # o filtro do que mentir — quem chama ve isto em `filtros_aplicados`.
        self.raridade_confiavel = not any("Amplified" in a for a in self.avisos)

    # ------------------------------------------------------------------ api

    def identificar(self, caminho):
        """
        Um recorte -> (item_id, similaridade, nivel_ou_None).

        ## Passa pelo mesmo caminho de `candidatos`

        A primeira versao fazia top-1 puro aqui e deixava o prior de nivel
        so em `candidatos`, que o contador nao chamava. Resultado: 17 dos 165
        erros eram `burletta-ii` lido como `burletta-iv` e `rattler-i` como
        `rattler-ii` — exatamente o que o prior existe para resolver, nao
        sendo usado.

        Manter os dois metodos separados era o erro: um mede similaridade
        pura, o outro mede o que o usuario ve. O contador tem de reportar o
        segundo.
        """
        top, n = self.candidatos(caminho, k=1)
        return top[0][0], top[0][1], n

    def candidatos(self, caminho, k=5):
        """Top-k, ja reordenado por nivel quando ha glifo."""
        img = ec.recorte_framed(caminho, self.mold)
        e = ec.emb([img], self.modelo, self.device)
        sim = (e @ self.gal.T)[0]
        ordem = torch.argsort(sim, descending=True)[:k]
        n, _ = NIVEL.ler(caminho, self.templates_nivel)
        saida = [(self.ids[int(j)], float(sim[int(j)])) for j in ordem]
        if n is not None:
            # ## Nivel como PRIOR, nao como filtro
            #
            # O leitor acerta mal uma parte das vezes (nao ha ground truth no
            # catalogo para provar o contrario). Se o nivel fosse filtro duro,
            # um erro de leitura descartaria o item certo — pior do que nao
            # filtrar. Aqui ele so **sobe** os candidatos do nivel lido.
            def chave(par):
                return (0 if NIVEL.nivel_do_id(par[0]) == n else 1, -par[1])
            saida.sort(key=chave)
        return saida, n

    def valor(self, item_id, quantidade=1):
        info = self.cat.get(item_id) or {}
        v = info.get("value")
        return (v if isinstance(v, (int, float)) else 0) * quantidade

    def total(self, caminhos, quantidades=None):
        """
        Soma o valor de catalogo de uma lista de recorte8.

        `quantidades` sobrepoe a quantidade lida da tela; quando ausente, cada
        recorte vale **1 unidade**.

        ## ## ## ## Por que a quantidade vem antes do valor

        Sem ela, o total sai errado por um fator de ordem de grandeza: o
        teste ao vivo somou **20** para uma mochila com `x100`, `x45`, `x80`
        e `x80`. Nao era erro de identificacao — era contar cada pilha como
        uma unidade.

        E o valor que a tela mostra continua sendo a referencia: o catalogo
        da a **base**, sem acessorios e sem desgaste, entao a soma por item
        so pode ser comparada com o total do jogo em condicao equivalente.
        Ver `ler-total-raid.py` para ler esse total.

        Devolve tambem o detalhe por celula, porque o que interessa num
        contador de raid nao e so o total: e saber **onde** olhar quando o
        total nao bate com a tela.
        """
        import quantidade as Q

        bib, meta = __import__("digitos").carregar()
        larg_qtd = meta.get("largura_qtd")
        if not larg_qtd:
            # Sem a medida da celula de quantidade nao ha como contar celulas.
            # Fallback: tenta com a do cabecalho, que e a mesma fonte.
            larg_qtd = meta.get("largura_celula")

        linhas = []
        total = 0
        confiaveis = 0
        # `quantidades_lidas` conta quantas celulas a tela realmente dixo a
        # quantidade. Distingue "somou com multiplicador" de "somou 1 por
        # celula e nao leu nada" — as duas dao um total, mas so uma serve.
        quantidades_lidas = 0
        cantidades_lidas = 0
        for n, caminho in enumerate(caminhos):
            item, sim, lvl = self.identificar(caminho)

            ## ## Quantidade: a tela manda, e o catalogo assume 1
            #
            ## `None` significa "a tela nao diz" — item sem pilha, ou leitura
            ## que nao passou no portao de tinta. Nos dois casos vale 1, que
            ## e o certo: item nao empilhavel ocupa uma unidade. Devolver
            ## `None` como zero seria pior — zeraria item de verdade.
            qtd = None
            if larg_qtd:
                try:
                    texto, _, _ = Q.ler_quantidade(caminho, bib, larg_qtd)
                    ## `quantidade` importa `digitos` com o apelido `D`; o
                    ## caminho e `Q.D`, nao `from quantidade import
                    ## digitos`, que levanta ImportError porque o nome nao
                    ## existe no modulo.
                    qtd = Q.D.como_numero(texto)
                except Exception as e:
                    ## ## Sem `except` largo aqui
                    ##
                    ## A primeira versao fazia `except Exception: qtd = None`.
                    ## Com um `TypeError` dentro (largura passada no lugar
                    ## certo), o contador seguia somando 1 por celula e **nao
                    ## reclamava** — o total errado continuava igual ao de
                    ## antes da quantidade, agora com um `try` dando a
                    ## impressao de que a leitura funcionava.
                    self.avisos.append(f"quantidade: {type(e).__name__}: {e}")
            if quantidades and n < len(quantidades) and quantidades[n]:
                qtd = int(quantidades[n])
            un = qtd if isinstance(qtd, int) and qtd > 0 else 1
            if qtd is not None:
                quantidades_lidas += 1

            v = self.valor(item, un)
            total += v
            if sim >= 0.70:
                confiaveis += 1
            linhas.append(
                {"caminho": str(caminho), "item": item, "similaridade": round(sim, 3),
                 "nivel": lvl, "quantidade": un, "quantidade_lida": qtd,
                 "valor": v}
            )
        return {
            "total": total,
            "celulas": len(caminhos),
            "confiaveis": confiaveis,
            "quantidades_lidas": quantidades_lidas,
            "detalhe": linhas,
            "avisos": self.avisos,
            "filtro_raridade": self.raridade_confiavel,
        }