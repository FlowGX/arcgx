"""
Conta a raid a partir de um frame capturado.

## ## O que este script e nao e

Nao e um classificador novo. E a ponte entre o que ja existe:

    ml/raid.py        encoder + nivel + amplificacao + valor de catalogo
    ml/moldura.py     a mesma moldura usada no treino
    ml/nivel.py       o numeral romano

A unica coisa nova aqui e **onde cortar**. As medidas vem de
`apps/main/src/scan/panels.ts`, que e a fonte da verdade; esta copia existe
porque o Python nao importa TypeScript, e por isso ela precisa ser conferida
quando a grade mudar. `conferir_geometry()` faz essa conferencia lendo o
`dist` compilado e abortando se divergir — porque uma grade errada aqui produz
uma contagem errada **sem nenhum aviso**, que e exatamente o modo de falha que
o `panels.ts` teve com a origem 367.
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(r"H:\Arcgxapp")
ML = RAIZ / "ml"
DIST_PAINELS = RAIZ / "apps" / "main" / "dist" / "scan" / "panels.js"

# ## Copia de `panels.ts` — conferida em tempo de execucao por `conferir_geometry`
PAINEIS = {
    "armazenamento": {"x": 152, "y": 271, "cols": 4, "rows": 5},
    # rows 6, nao 5.
    #
    # A mochila cresce com upgrade de capacidade: o jogo escreve "6/22" numa
    # captura e "4/20" noutra. A 6a linha fica em y 791..895 — **fora** do ROI
    # de 520 px, que cortava em y=791. Com 5 linhas o contador achava 4 itens
    # num slot que tinha 6, e dois deles eram municao (x60 e x40).
    #
    # Descoberto cruzando o x/y lido do cabecalho com a contagem de celulas por
    # imagem: o jogo dizia 6, a grade dizia 4, e a diferenca era exatamente a
    # linha que o ROI nao cobria.
    "mochila": {"x": 1043, "y": 271, "cols": 4, "rows": 6},
    "uso-rapido": {"x": 1503, "y": 271, "cols": 3, "rows": 2},
    "bolso-seguro": {"x": 1503, "y": 711, "cols": 3, "rows": 1},
}

CEL_W, CEL_H, PASSO = 92, 104, 104

# ## Limiar de "celula ocupada"
#
# Calibrado pelo proprio jogo: a MOCHILA de `inventario-02.png` diz "9/20", e o
# contador tem de achar 9. Valor alto de proposito — errar para "vazia" joga
# item fora da conta sem ruido, enquanto errar para "ocupada" inventa valor.
VAZIO_FRACAO = 0.12


def _carregar(nome, caminho):
    spec = importlib.util.spec_from_file_location(nome, caminho)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod


def conferir_geometry():
    """
    Confere a tabela acima contra o `panels.js` compilado.

    Sem isto, mudar a grade no app deixaria o Python cortando a regao antiga e
    produzindo um total plausivel e errado. E o modo de falha que a origem 367
    teve: o recorte continuava "parecendo" uma celula, entao nada reclamava.
    """
    if not DIST_PAINELS.exists():
        print("aviso: dist/scan/panels.js nao existe; nao da para conferir a grade")
        return
    txt = DIST_PAINELS.read_text(encoding="utf-8")
    for pid, geo in PAINEIS.items():
        m = re.search(
            rf"id:\s*'{re.escape(pid)}'.*?x:\s*(\d+)\s*/\s*1920.*?y:\s*(\d+)\s*/\s*1080"
            rf".*?cols:\s*(\d+),\s*rows:\s*(\d+)",
            txt,
            re.S,
        )
        if not m:
            print(f"aviso: painel {pid} nao encontrado no dist")
            continue
        dx, dy, dc, dr = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        if (dx, dy, dc, dr) != (geo["x"], geo["y"], geo["cols"], geo["rows"]):
            raise SystemExit(
                f"grade divergente em {pid}: python tem "
                f"({geo['x']},{geo['y']}) {geo['cols']}x{geo['rows']}, "
                f"dist tem ({dx},{dy}) {dc}x{dr}\n"
                f"atualize PAINEIS em {Path(__file__).name}"
            )


def abrir_frame(caminho):
    """
    Abre um frame capturado.

    ## ## ## Por que BGRA e nao PNG

    O `wgc-capture` nao expoe `captureFrame` nem `toPng`. O ciclo e
    `startCapture` / `pollFrame` / `stopCapture`, e `pollFrame` devolve um
    **buffer plano BGRA** com `stride` bytes por pixel. O gravador entao
    escreve `frame.raw` e um `.json` ao lado com largura, altura, stride e
    canais.

    A primeira versao deste script assumia PNG e so quebrava em uso — que e o
    pior jeito de descobrir, porque a calibracao usava arquivos PNG de outra
    origem e passava.
    """
    if caminho.suffix.lower() == ".png":
        return Image.open(caminho).convert("RGB")

    meta = {}
    lado = caminho.with_suffix(".json")
    if not lado.exists():
        raise SystemExit(
            f"faltou o metadado {lado.name} — o frame bruto precisa do "
            f".json com largura/altura/stride ao lado"
        )
    meta = json.loads(lado.read_text(encoding="utf-8"))
    w, h = meta["width"], meta["height"]
    bpp = meta.get("stride") or (4 * meta.get("canais", 4))

    dados = np.fromfile(caminho, dtype=np.uint8)
    quad = dados[: w * h * bpp].reshape(h, w, bpp)
    # BGRA -> RGB. `f.data` vem do D3D e e BGRA, nao RGBA.
    rgb = quad[:, :, 2::-1] if bpp == 4 else quad[:, :, :3]
    return Image.fromarray(np.ascontiguousarray(rgb), "RGB")


def main():
    if len(sys.argv) < 3:
        print("uso: contar-live.py <frame.png> <painel-id>")
        return
    frame_path = Path(sys.argv[1])
    painel_id = sys.argv[2]

    geo = PAINEIS.get(painel_id)
    if not geo:
        print(f"painel desconhecido: {painel_id} (use um de {list(PAINEIS)})")
        return

    conferir_geometry()

    raid = _carregar("raid", ML / "raid.py")
    contador = raid.Contador()

    img = abrir_frame(frame_path)
    W, H = img.size
    escala_x, escala_y = W / 1920, H / 1080
    print(f"frame: {frame_path.name} {W}x{H}  escala {escala_x:.3f}x{escala_y:.3f}")
    print(f"painel: {painel_id}  origem ({geo['x']}, {geo['y']})  {geo['cols']}x{geo['rows']}")

    ## Recorte da area do painel, para conferir visualmente se a grade bate
    px = round(geo["x"] * escala_x)
    py = round(geo["y"] * escala_y)
    pw = round(CEL_W * escala_x)
    ph = round(CEL_H * escala_y)
    passo = round(PASSO * escala_x)
    imagem_painel = img.crop(
        (px, py, px + passo * (geo["cols"] - 1) + pw, py + round(PASSO * escala_y) * (geo["rows"] - 1) + ph)
    )
    saida_painel = RAIZ / "dados" / "rotulo" / "live-painel.png"
    saida_painel.parent.mkdir(parents=True, exist_ok=True)
    imagem_painel.save(saida_painel)
    print(f"recorte do painel -> {saida_painel}")

    ## ## Cabecalho do ARMAMENTO, para ler o total do jogo
    #
    # O valor do jogo e ground truth. Nao ha OCR pronto para ele ainda, entao
    # o script recorta a regiao e a gente le na imagem. E uma verificacao de
    # uma vez so — nao entra no caminho automatico.
    cab = img.crop((round(770 * escala_x), round(140 * escala_y),
                    round(1150 * escala_x), round(200 * escala_y)))
    saida_cab = RAIZ / "dados" / "rotulo" / "live-armamento.png"
    cab.resize((cab.width * 2, cab.height * 2), Image.LANCZOS).save(saida_cab)
    print(f"cabecalho ARMAMENTO -> {saida_cab}  (ler o total do jogo aqui)")

    ## ## ## ## A pasta de celulas tem de ser limpa ANTES de cada captura
    #
    # Os arquivos se chamam pela **posicao** na grade (`mochila-00-03`), nao
    # por conteudo. Uma captura que encontra 4 celulas escreve 4 arquivos; os
    # outros 16 que ja estavam lao vem de uma execucao **anterior**, com
    # outra tela, e ficam parecendo dados atuais.
    #
    #Foi exatamente o que aconteceu: a captura ao vivo achou 4 celulas e
    # sobrescreveu so essas; ao medir a tinta, 12 "celulas sem pilha" davam
    # 118 px — a mesma das celulas com quantidade. Nao era o sprite invadindo
    # a regiao: eram sobras de outra captura, com `x80` legitimo.
    #
    # Sem esta limpeza, qualquer medicao da quantidade mistura duas telas e
    # ninguem sabe qual numero e de qual.
    temp = RAIZ / "dados" / "rotulo" / "live-celulas"
    if temp.exists():
        for antigo in temp.glob("*.png"):
            antigo.unlink()
    temp.mkdir(parents=True, exist_ok=True)

    linhas = []
    for j in range(geo["rows"]):
        for i in range(geo["cols"]):
            cx = px + i * passo
            cy = py + j * round(PASSO * escala_y)
            cel = img.crop((cx, cy, cx + pw, cy + ph))
            arr = np.asarray(cel.convert("RGB"), dtype=np.float32)
            ## ## Celula vazia: fracao de pixels que fogem do fundo
            #
            # O primeiro teste usou `arr.std() < 6` e passou nas 20 celulas —
            # a MOCHILA tem 9 ocupadas. Slot vazio nao e chapado: tem borda,
            # gradiente e o icone de cadeado do BOLSO SEGURO, entao o desvio
            # padrao fica alto mesmo sem item.
            #
            # O que separa mesmo e a **quantidade de tinta**: um slot vazio e
            # quase todo a cor de fundo, enquanto um ocupado tem o sprite
            # inteiro contrastando. Entao mede a fracao de pixels que se
            # afastam da mediana, nao o desvio da media.
            lum = arr.mean(axis=2)
            fora = float((np.abs(lum - np.median(lum)) > 25).mean())
            if fora < VAZIO_FRACAO:
                continue
            p = temp / f"{painel_id}-{i:02d}-{j:02d}.png"
            cel.save(p)

            ## ## ## O mesmo recorte em BGRA cru, para o teste em Node
            ##
            ## `tools/testar-classificador.mjs` roda o ONNX por Node e precisa
            ## dos pixels. Decodificar PNG em JS exigiria `pngjs`, que nao esta
            ## no monorepo — e dependencia nativa so para um recorte de teste
            ## e desproporcional. O PIL ja tem a imagem em memoria.
            ##
            ## BGRA de proposito: e o que o D3D11 entrega e o que o
            ## `cell-vision` le. Treinar o classificador em RGB e rodar em
            ## BGRA da casamento errado **sem erro nenhum**.
            ## `split()` devolve (R, G, B, A) nesta ordem — o nome `_b` guardava
            ## o canal **vermelho**, e o arquivo saia RGB. O Node lia como
            ## BGRA, entao vermelho e azul estavam trocados: as similaridades
            ## despencaram para 0,12 contra 0,6 do Python, e a latencia ficou
            ## 3x pior (44,6 ms contra 15,6 ms em 9 celulas).
            ##
            ## Nada disso acusa erro: o encoder aceita a imagem, devolve um
            ## vetor, e a busca acha "alguma coisa". Troca de canal e erro de
            ## leitura e erro de conceito — silencioso dos dois jeitos.
            canais = cel.convert("RGBA").split()
            vermelho, verde, azul, alfa = canais
            bgra = Image.merge("RGBA", (azul, verde, vermelho, alfa))
            (temp / f"{painel_id}-{i:02d}-{j:02d}.bgra").write_bytes(bgra.tobytes())
            linhas.append((p, round(fora, 3)))

    print(f"\ncelulas com conteudo: {len(linhas)}")
    caminhos = [p for p, _ in linhas]
    r = contador.total(caminhos)

    print(f"\n{'celula':<16} {'item':<28} {'sim':>6} {'niv':>4} {'valor':>9}")
    print("-" * 70)
    for ln in r["detalhe"]:
        nome = Path(ln["caminho"]).stem
        print(f"{nome:<16} {ln['item']:<28} {ln['similaridade']:>6.3f} "
              f"{str(ln['nivel'] or '-'):>4} {ln['valor']:>9,}")

    print("-" * 70)
    print(f"celulas          : {r['celulas']}")
    print(f"confiaveis (>=0.70): {r['confiaveis']}")
    print(f"TOTAL catalogo   : {r['total']:,}")
    print(f"filtro de raridade aplicado: {r['filtro_raridade']}")
    if r["avisos"]:
        print("\navisos:")
        for a in r["avisos"]:
            print(f"  ! {a}")
    print("\nATENCAO: este total e de CATALOGO (base, sem acessorios).")
    print("A tela mostra base + acessorios e cai com o desgaste — a diferenca")
    print("entre os dois NAO e erro de identificacao.")


if __name__ == "__main__":
    main()
