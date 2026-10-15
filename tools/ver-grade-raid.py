"""
Verifica as grades da raid cortando de verdade.

## Por que o detector nao basta

`medir-paineis.py` acha origem x com consistencia (o passo x de 104 bate nos
paineis), mas o passo y sai ruidoso — 27, 80, 48 — porque a projecao de
gradiente pega **conteudo** dos cards (sprite, icone, texto), nao a borda. A
origem y fica boa por acaso, quando o primeiro pico cai na borda do primeiro
card.

Foi exatamente o que aconteceu com `panels.ts`: origem x correta, passo
correto, origem y apontando para a **segunda** linha. So apareceu porque alguem
cortou e olhou.

Entao aqui: corta a grade detectada e mostra. Se as bordas dos cards fecharem
nas quatro bordas do recorte, a medida vale.

## O que cada painel e

    MOCHILA      4 x 5 = 20 slots   (rotulo no jogo: "9/20")
    USO RAPIDO   3 x 2 =  5 slots   ("4/5")
    BOLSO SEGURO 3 x 1 =  3 slots   ("2/2", "0/3")
    EQUIPAMENTO  2 Slots de armadura + 2 de arma, **maiores**

O `cellWidth` e `cellHeight` sao os do ARMAZENAMENTO (92 x 104), porque o
card e o mesmo componente da UI em tamanho igual nos tres. O que muda e a
grade e a posicao.
"""

from pathlib import Path

from PIL import Image, ImageDraw

CAPTURA = Path(r"H:\Arcgxapp-ref\captures\inventario-02.png")
SAIDA = Path(r"H:\Arcgxapp\dados\rotulo\grade-raid.png")

CEL_W, CEL_H, PASSO = 92, 104, 104

PAINEIS = [
    ("MOCHILA", 1043, 271, 4, 5),
    ("USO RAPIDO", 1503, 271, 3, 2),
    ("BOLSO SEGURO", 1503, 711, 3, 1),
]


def main():
    img = Image.open(CAPTURA).convert("RGB")
    ESC = 3

    colunas = []
    for nome, x, y, cols, rows in PAINEIS:
        folha = Image.new("RGB", (cols * CEL_W, rows * CEL_H), (12, 12, 16))
        for j in range(rows):
            for i in range(cols):
                cx, cy = x + i * PASSO, y + j * PASSO
                cel = img.crop((cx, cy, cx + CEL_W, cy + CEL_H))
                folha.paste(cel, (i * CEL_W, j * CEL_H))
        colunas.append((nome, folha, cols, rows))

    W = sum(f.size[0] * ESC + 20 for _, f, _, _ in colunas)
    H = max(f.size[1] * ESC for _, f, _, _ in colunas) + 30
    saida = Image.new("RGB", (W, H), (12, 12, 16))
    d = ImageDraw.Draw(saida)
    x = 0
    for nome, folha, cols, rows in colunas:
        saida.paste(folha.resize((folha.size[0] * ESC, folha.size[1] * ESC), Image.NEAREST), (x, 30))
        d.text((x + 2, 4), f"{nome}  {cols}x{rows}", fill=(255, 220, 120))
        d.text((x + 2, 17), f"origem ({x // ESC + 0}, ) passo {PASSO}", fill=(140, 150, 165))
        x += folha.size[0] * ESC + 20

    saida.save(SAIDA)
    print(f"-> {SAIDA}")
    print("\nSe as bordas azuis dos cards fecharem em cada recorte, a medida vale.")


if __name__ == "__main__":
    main()