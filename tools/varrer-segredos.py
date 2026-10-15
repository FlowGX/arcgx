"""Varre a arvore de codigo procurando segredo antes do primeiro commit.

## ## ## Por que um script e nao um `grep`

Porque o criterio nao e "a linha tem a palavra `token`": e "esta linha
**parece** uma credencial de verdade". Um regex puro dispara em `tokenBudget`,
em `accessToken` de tipo e em `senhaDoBanco`, e o resultado verdadeiro fica
escondido no meio de 200 falsos positivos.

Aqui o que importa:
  1. nao varrer `node_modules`, venv, `target/` e `release/` (tera, nao codigo);
  2. separar "nome de variavel" de "valor de credencial";
  3. imprimir a linha, para dar para decidir com os olhos.

Uso:  python tools/varrer-segredos.py
"""

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Diretoros que nao sao codigo: dependencias, build, dados de captura.
IGNORAR_DIRS = {
    ".git", "node_modules", ".venv-treino", "venv", "target", "release",
    "build", "dist", "out", ".wrangler", "__pycache__", ".next", "coverage",
}

# Extensoes que nao valem varredura.
IGNORAR_EXT = {
    ".exe", ".dll", ".node", ".onnx", ".png", ".jpg", ".jpeg", ".ico", ".gz",
    ".zip", ".7z", ".bin", ".db", ".sqlite", ".wasm", ".pyc", ".pdf", ".mp4",
}

# ## ## ## Padroes de VALOR (o que realmente vaza)
#
# Entram aqui so sequencias que nao poderiam aparecer num nome de variavel.
PADROES: list[tuple[str, str]] = [
    ("github_pat", r"github_pat_[A-Za-z0-9_]{20,}"),
    ("gh token", r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    ("openai", r"\bsk-[A-Za-z0-9]{20,}"),
    ("aws key", r"\bAKIA[0-9A-Z]{16}\b"),
    ("google api", r"\bAIza[0-9A-Za-z_\-]{30,}"),
    ("slack", r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    ("private key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("jwt", r"\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    # r2 / cloudflare: o padrao doToken que ja vazou neste projeto
    ("r2/cloudflare", r"(?i)\b[A-Za-z0-9_-]{40,}\b(?=[^\n]*r2)"),
]

# ## ## ## Atribuicoes suspeitas: nome de chave seguido de valor literal
#
# Exige aspas em volta do valor, para nao casar com `const token = lerToken()`.
ATRIB = re.compile(
    r"(?i)\b(api[_-]?key|secret|token|senha|password|passwd|bearer)\b"
    r"\s*[:=]\s*"
    r"['\"`]([^\s'\"`]{12,})['\"`]"
)


def pule(p: Path) -> bool:
    if any(parte in IGNORAR_DIRS for parte in p.parts):
        return True
    return p.suffix.lower() in IGNORAR_EXT


def main() -> int:
    achados: list[tuple[str, int, str, str]] = []
    varridos = 0

    for arquivo in RAIZ.rglob("*"):
        if not arquivo.is_file() or pule(arquivo.relative_to(RAIZ)):
            continue
        if arquivo.name in {"package-lock.json", "Cargo.lock"}:
            continue
        try:
            texto = arquivo.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        varridos += 1
        rel = arquivo.relative_to(RAIZ)

        for nome, pad in PADROES:
            for m in re.finditer(pad, texto):
                linha = texto.count("\n", 0, m.start()) + 1
                achados.append((str(rel), linha, nome, m.group(0)[:60]))

        for m in ATRIB.finditer(texto):
            valor = m.group(2)
            # Ignora placeholder e nome de tipo.
            if re.match(r"(?i)^(string|number|boolean|undefined|null|readonly|\w+\[\])$", valor):
                continue
            linha = texto.count("\n", 0, m.start()) + 1
            achados.append((str(rel), linha, "atribuicao", f"{m.group(1)}={valor[:40]}"))

    print(f"{varridos} arquivo(s) de codigo varrido(s).")

    if not achados:
        print("\nOK: nenhum valor de credencial encontrado.")
        return 0

    print(f"\n{len(achados)} achado(s) — revise CADA um antes do commit:\n")
    for rel, linha, nome, trecho in sorted(achados):
        print(f"  {rel}:{linha}  [{nome}]  {trecho}")
    print("\nSe for falso positivo, use 'gitleaks:allow' ou adjuste PADROES.")
    return 1


if __name__ == "__main__":
    sys.exit(main())