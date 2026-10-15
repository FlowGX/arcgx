"""Gera `assets/icon.ico` a partir do logo do app.

## ## ## Por que este script existe

`electron-builder.yml` referencia `assets/icon.ico` em quatro lugares
(`win.icon`, `nsis.installerIcon`, `nsis.uninstallerIcon` e `extraResources`),
e o `TrayIcon` carrega o mesmo caminho em tempo de execucao. O diretorio
`assets/` nao existia no projeto: o empacotamento reclamava `file source
doesn't exist` e seguia com o icone padrao do Electron, e a bandeja ficava
sem imagem.

## ## ## ## Por que varios tamanhos

Windows escolhe o icone pelo tamanho do alvo: 16 px na barra de tarefas, 32 px
na bandeja, 48 px na janela, 256 px no Explorer. Um unico PNG de 512 px
funciona, mas e reamostrado com serrilhado nos tamanhos pequenos — a bandeja
e o lugar onde o icone mais aparece.

## ## ## ## Por que PNG dentro do .ico

O formato ICO aceita entrada codificada em PNG desde o Windows Vista. Evita
ter um PNG de 32x32 de 8 bits, que perderia o canal alfa (o fundo do icone
ficaria preto em vez de transparente).

Uso:  python tools/gerar-icone.py
"""

from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "apps" / "renderer" / "desktop" / "public" / "logo-512.png"
SAIDA_DIR = RAIZ / "assets"
SAIDA = SAIDA_DIR / "icon.ico"

# Ordem decrescente: o Windows escolhe pelo maior que couber no alvo.
TAMANHOS = (256, 128, 64, 48, 32, 24, 16)


def main() -> None:
    if not ORIGEM.is_file():
        raise SystemExit(f"logo nao encontrado: {ORIGEM}")

    base = Image.open(ORIGEM).convert("RGBA")
    # Quadrado: qualquer PNG nao-quadrado e um logo em fundo, nao uma arte com
    #比例 a preservar.
    lado = min(base.size)
    if lado != base.size[0] or lado != base.size[1]:
        off = ((base.size[0] - lado) // 2, (base.size[1] - lado) // 2)
        base = base.crop(off[0], off[1], off[0] + lado, off[1] + lado)

    SAIDA_DIR.mkdir(parents=True, exist_ok=True)

    # Pillow escreve o ICO multi-resolucao a partir das copias ja em memoria.
    # `append_images` exige o mesmo modo; RGBA em todas.
    quadros = []
    for tam in TAMANHOS:
        # LANCZOS em reducros grandes fica serrilhado; `reducing_gap` faz o
        # Pillow passar por um mipmap antes.
        r = base if tam == lado else base.resize((tam, tam), Image.LANCZOS, reducing_gap=2.0)
        quadros.append(r)

    quadros[0].save(SAIDA, format="ICO", sizes=[(t, t) for t in TAMANHOS], append_images=quadros[1:])

    # O Windows usa 0 para 256 no diretorio do ICO, entao o PIL precisa receber
    # o tamanho real para gravar a entrada. Reescreve manualmente se preciso.
    confere = Image.open(SAIDA)
    entradas = sorted(confere.info.get("sizes", []))
    print(f"{SAIDA.relative_to(RAIZ)}  {SAIDA.stat().st_size / 1024:.1f} KB  tamanhos={entradas}")


if __name__ == "__main__":
    main()