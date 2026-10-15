"""
A geometria do ARMAZENAMENTO esta certa? Teste de corte, nao de opiniao.

## A duvida

`panels.ts` grava origem y=367. Nas duas capturas de referencia
(`inventario-01`, `inventario-02`), a primeira linha de cards do
ARMAZENAMENTO comeca visivelmente em **y ~ 275** — o passo e 104 nos dois
casos, e a origem x bate (152), mas y nao.

## Por que isso pode ter passado despercebido

Um crop deslocado verticalmente em ~90 px **ainda parece uma celula**: o passo
e 104 e o card tem ~96 de altura, entao cortar 90 px abaixo pega o card
seguinte, quase inteiro. As imagens de `grade-celula.png` mostravam celulas
com barra e numeral —看起来 corretas. O erro so apareceria comparando o
conteudo com o gabarito, e o gabarito foi preenchido **dentro do crop errado**,
ou seja, auto-consistente.

Este script corta o mesmo frame nas duas origens candidatas e imprime lado a
lado, para o olho decidir qual delas cai na borda do card.

A borda importa: se o crop pega a borda superior/inferior do card, a
geometria esta errada. Se o recorte pega so o miolo, pode estar deslocado e
ainda assim "parecer" certo.
"""

from pathlib import Path

from PIL import Image, ImageDraw

CAPTURA = Path(r"H:\Arcgxapp-ref\captures\inventario-01.png")
SAIDA = Path(r"H:\Arcgxapp\dados\rotulo\teste-origem.png")

CEL_W, CEL_H = 92, 104
CANDIDATAS = [
    ("y=367 (panels.ts)", 152, 367),
    ("y=275 (visual)", 152, 275),
    ("y=271 (detector)", 151, 271),
    ("y=279", 152, 279),
]


def main():
    img = Image.open(CAPTURA).convert("RGB")
    ESC = 5
    W = CEL_W * ESC
    H = CEL_H * ESC
    folha = Image.new("RGB", ((W + 10) * len(CANDIDATAS), H + 28), (12, 12, 16))
    d = ImageDraw.Draw(folha)

    for n, (rotulo, x, y) in enumerate(CANDIDATAS):
        c = img.crop((x, y, x + CEL_W, y + CEL_H))
        folha.paste(c.resize((W, H), Image.NEAREST), (n * (W + 10), 28))
        d.text((n * (W + 10) + 2, 4), rotulo, fill=(255, 220, 120))
        d.text((n * (W + 10) + 2, 16), f"x={x}", fill=(150, 150, 160))

    folha.save(SAIDA)
    print(f"-> {SAIDA}")
    print("\nQual dos quatro recorta comeca e termina dentro de um card?")


if __name__ == "__main__":
    main()