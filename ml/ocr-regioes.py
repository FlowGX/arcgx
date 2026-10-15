"""
Leitor OCR por regiao, com saida tipada.

## Por que nao chamo o `det` na tela inteira

O `det` fatia a tela toda em caixas horizontais que contem icone + fundo, e o
`rec` le os pixels que existem: `'FDIBS'`. Ver `DIAGNOSTICO-OCR.md`.

O HUD do jogo tem layout **fixo**. A janela "1:35" esta sempre no mesmo
pixel. Nao existe necessidade de descobrir isso a cada frame — e descobrir da
e o que produz o falso positivo. Aqui cada regiao e recortada pela fracao
salva em `regioes.json`, o `det` roda **dentro** dela, e o resultado so passa
se casar com forma de dado.

## Tipagem, e por que

O consumidor nao e "uma tela". E "quanto falta pro evento" (relogio),
"quanto eu carrego" (contador), "quanto pesa" (decimal). Devolver texto cru
joga essa decisao para o renderer. Aqui cada leitura ja vem com o tipo, e o
renderer so escolhe como exibir.

E um valor sem tipo esta errado mesmo quando acerta o numero: `'547/945'`
lerado como '547945' perde a divisao, e quem divide depois nao sabe.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(r"H:\Arcgxapp")
OCR_DIR = RAIZ / "ml" / "modelo" / "ocr"
REGIOES = RAIZ / "dados" / "rotulo" / "regioes.json"

RELOGIO = re.compile(r"(\d{1,2})\s*[:.\uFF1A]\s*(\d{2})")
FRACAO = re.compile(r"(\d+)\s*/\s*(\d+)")
DECIMAL = re.compile(r"(?<![\d/])(\d{1,6}(?:[.,]\d{1,3})?)(?![\d/])")
INTEIRO = re.compile(r"\d{1,6}")
SUFIXO_X = re.compile(r"[x\u00D7]\s*(\d{1,3})", re.I)


def sem_acento(t: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn"
    )


@dataclass
class Leitura:
    """Uma leitura ja interpretada."""

    regiao: str
    tipo: str  # relogio | fracao | decimal | inteiro | multiplicador
    bruto: str
    valor: float
    texto: str
    confianca: float
    caixa: tuple[int, int, int, int]

    def para_json(self) -> dict:
        return {
            "regiao": self.regiao,
            "tipo": self.tipo,
            "bruto": self.bruto,
            "valor": self.valor,
            "texto": self.texto,
            "confianca": self.confianca,
            "caixa": list(self.caixa),
        }


@dataclass
class Resultado:
    leituras: list[Leitura] = field(default_factory=list)

    def por_regiao(self) -> dict[str, list[Leitura]]:
        d: dict[str, list[Leitura]] = {}
        for l in self.leituras:
            d.setdefault(l.regiao, []).append(l)
        return d

    def para_json(self) -> dict:
        return {
            "total": len(self.leituras),
            "leituras": [l.para_json() for l in self.leituras],
        }


def interpretar(regiao: str, bruto: str, confianca: float, caixa) -> list[Leitura]:
    """
    Classifica a leitura pelo formato.

    A ordem importa: `547/945` casa com fracao antes de virar dois inteiros,
    e `1:35` precisa ser relogio antes de virar `1` e `35`. Erro de ordem aqui
    nao quebra nada — vira dado errado, que e pior.
    """
    t = sem_acento(bruto).strip()
    if not t:
        return []
    saida = []

    m = RELOGIO.search(t)
    if m:
        mm, ss = int(m.group(1)), int(m.group(2))
        if ss < 60 and mm < 100:
            saida.append(
                Leitura(regiao, "relogio", bruto, mm * 60 + ss, f"{mm:02d}:{ss:02d}", confianca, caixa)
            )
            return saida

    m = FRACAO.search(t)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if b > 0:
            saida.append(Leitura(regiao, "fracao", bruto, a / b, f"{a}/{b}", confianca, caixa))
            return saida

    m = SUFIXO_X.search(t)
    if m:
        saida.append(
            Leitura(regiao, "multiplicador", bruto, float(m.group(1)), f"x{m.group(1)}", confianca, caixa)
        )
        return saida

    m = DECIMAL.search(t)
    if m:
        v = float(m.group(1).replace(",", "."))
        tipo = "decimal" if re.search(r"[.,]\d", m.group(1)) else "inteiro"
        saida.append(Leitura(regiao, tipo, bruto, v, m.group(1), confianca, caixa))
        return saida

    return saida


class LeitorOCR:
    """Leitor por regiao. Carrega os ONNX uma vez e reutiliza."""

    def __init__(self, det, rec, detectar, reconhecer):
        self.det = det
        self.rec = rec
        self._detectar = detectar
        self._reconhecer = reconhecer

    @classmethod
    def carregar(cls):
        import importlib.util

        import onnxruntime as ort

        spec = importlib.util.spec_from_file_location("t", RAIZ / "ml" / "testar-ocr.py")
        ocr = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ocr)
        return cls(
            ort.InferenceSession(str(OCR_DIR / "PP-OCRv5_mobile_det.onnx"), providers=["CPUExecutionProvider"]),
            ort.InferenceSession(str(OCR_DIR / "latin_PP-OCRv5_mobile_rec.onnx"), providers=["CPUExecutionProvider"]),
            ocr.detectar,
            ocr.reconhecer,
        )

    def ler(self, img, regioes: list[dict], limiar=0.5) -> Resultado:
        """
        Le todas as regioes de uma imagem.

        `det` roda **dentro** da regiao, nao na tela. Isso e o ponto: um recorte
        de 1920 px de largura faz o detector fatiar icone; o recorte de uma
        regiao de 200 px faz ele procurar texto.
        """
        import numpy as np

        res = Resultado()
        w, h = img.size

        for r in regioes:
            box = (
                int(r["x"] * w),
                int(r["y"] * h),
                int((r["x"] + r["width"]) * w),
                int((r["y"] + r["height"]) * h),
            )
            if box[2] - box[0] < 12 or box[3] - box[1] < 8:
                continue
            recorte = img.crop(box)
            try:
                caixas = self._detectar(self.det, np.asarray(recorte), limiar=limiar)
            except Exception:
                continue

            for b in caixas:
                try:
                    texto, conf = self._reconhecer(self.rec, recorte.crop(b))
                except Exception:
                    continue
                if not texto.strip():
                    continue
                # so dado: a regra medida em `extrair-ocr-labels.py`
                if not any(c.isdigit() for c in texto):
                    continue
                global_box = (box[0] + b[0], box[1] + b[1], box[0] + b[2], box[1] + b[3])
                res.leituras.extend(interpretar(r["id"], texto, conf, global_box))

        return res