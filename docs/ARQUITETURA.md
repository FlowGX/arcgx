# Arquitetura do Arc GX

## Objetivo

App desktop **Windows** que lê a tela do jogo por captura de GPU, identifica itens por visão
computacional + OCR e desenha um HUD (overlay) sobre a janela do jogo. Painel de configuração
próprio ao lado.

## Decisões técnicas

| Decisão | Escolha | Motivo |
|---|---|---|
| Shell | Electron 42 | overlay + painel em um binário só, `safeStorage`, `autoUpdater` prontos |
| UI | Preact + Vite | ~4 KB de runtime; HUD roda a 15 Hz e não pode pesar |
| Nativos | Rust + `@napi-rs/cli` (N-API) | hot path de visão fora do JS e sem pressão de GC |
| Captura | Windows Graphics Capture (WinRT) | captura por GPU, zero cópia para tela, funciona em fullscreen |
| Visão | OpenCV (Rust) + ONNX Runtime (DML → CPU) | DirectML aproveita a GPU; CPU garante funcionar sem ela |
| Dados | "data-release" content-addressed | modelos não vão no instalador; update sem reempacotar |
| Persistência | `node:sqlite` + JSON de config | sem dependência nativa extra |
| Empacotamento | electron-builder (NSIS) + electron-updater | feed genérico em CDN |

Detalhes e justificativas em `REFERENCIA-TECNICA.md`.

## Estrutura do repositório

```
arcgxapp/
├─ apps/
│  ├─ main/                  processo Electron principal
│  │  └─ src/
│  │     ├─ index.ts         bootstrap, single instance, tray
│  │     ├─ windows/         panel.ts (desktop) · overlay.ts (HUD)
│  │     ├─ capture/         manager.ts (ponte p/ wgc-capture)
│  │     ├─ ipc/             registro tipado dos canais
│  │     ├─ update/          updater.ts
│  │     └─ store/           config.ts · db.ts (sqlite)
│  ├─ workers/               worker_threads de CPU
│  │  ├─ scan-worker.ts      inferência ONNX por célula
│  │  ├─ ocr-worker.ts       OCR
│  │  └─ map-worker.ts       dados de mapa
│  └─ renderer/
│     ├─ desktop/            Preact — painel de configuração
│     └─ overlay/            Preact — HUD
├─ packages/
│  ├─ shared/                tipos, canais IPC, paths, config, data-release, logger
│  ├─ design/                tokens.css + components.css
│  └─ native/
│     ├─ wgc-capture/        Rust N-API: WGC/D3D11
│     └─ cell-vision/        Rust N-API: OpenCV
└─ docs/
    ├─ REFERENCIA-TECNICA.md decisões de engenharia
    └─ ARQUITETURA.md        visão geral
```

## Fluxo de dados do scan

```
jogo (janela)
   │  Windows Graphics Capture  → frames BGRA (addon Rust, thread dedicada)
   ▼
main (capture manager)  ──►  overlay (HUD simples: posição/estado)
   │
   ├─► cell-vision  : recorte da ROI do inventário → Canny → findContours → células RGBA
   │
   ├─► ocr-worker  : detecção + reconhecimento de texto (PaddleOCR ONNX / Windows OCR)
   │                    → nomes, quantidade, preço
   │
   └─► scan-worker : ONNX Runtime (DirectML, fallback CPU)
                         slot_detector → item_embedder → galeria → trained_model → tier_cnn
   │
   ▼
resultado { item, tier, qty, preço, célula } → IPC `overlay:scan-result` → HUD desenha badge
```

## Canais IPC

Todos declarados em `packages/shared/src/channels.ts` e tipados. Convenção: `<janela>:<ação>`.

- `desktop:*` — painel de configuração (config, auth, itens, raids, mapa, conta)
- `overlay:*` — HUD (`scan-result`, `geometry`, `stash-status`, `map-pins`, `map-view`, `search-*`)

## Data release

Manifesto em `current.json`:

```jsonc
{
  "schema": 1,
  "manifestId": "<hash determinístico do conteúdo>",
  "files": {
    "game/items.json":     { "sha256": "...", "bytes": 0, "key": "data/<sha256>.json" },
    "models/x.onnx": { "sha256": "...", "bytes": 0, "key": "data/<sha256>.onnx" }
  },
  "optional": { "paddle-ocr": { /* ... */ } }
}
```

Download no cliente: `objects/<sha256><ext>` (dedupe por conteúdo) e montagem
final em `releases/<manifestId>/`. `ARC_DATA_RELEASE_URL` sobrescreve a origem
— aceita `file://` para dev offline.

Gerador: `npm run data:publish -- --src <fonte> --out <destino>`.

Schema dos dados e resolução de idioma: `packages/shared/src/game-schema.ts`
(`resolveText` com cadeia `pt-BR → pt → en`, `toTier` mapeando raridade crua do
jogo para o tier do Arc GX).

## Variáveis de ambiente

```
ARC_DATA_RELEASE_URL   ARC_API_BASE_URL       ARC_UPDATE_FEED_URL
ARC_SCAN_TARGET_HZ     ARC_OVERLAY_HZ         ARC_OCR_ENGINE
ARC_VISION_ADDON       ARC_CAPTURE_ADDON      ARC_DEBUG_OVERLAY
ARC_LOG_FILE
```

## Roadmap

1. **Fase 1 — esqueleto**: janelas, preload, IPC, config, tray, updater.
2. **Fase 2 — captura**: `wgc-capture` em Rust (HWND → frames BGRA).
3. **Fase 3 — visão**: `cell-vision` em Rust (contornos) + `scan-worker` com ONNX/DML.
4. **Fase 4 — OCR**: `ocr-worker` + integração Windows OCR.
5. **Fase 5 — HUD**: badges, cartões, mapa interativo.
6. **Fase 6 — serviço**: API REST própria + data-release em CDN + auto-update.

## Licenças de terceiros

| Lib | Licença |
|---|---|
| Electron | MIT |
| Preact | MIT |
| Leaflet | BSD-2-Clause |
| lucide | ISC |
| OpenCV | Apache-2.0 |
| ONNX Runtime | MIT |
| ONNX Runtime DirectML | MIT |
| PaddleOCR | Apache-2.0 |
| `windows` crate | MIT / Apache-2.0 |

## Nota de independence

O Arc GX é um projeto independente, sem vínculo com a Embark Studios (ARC Raiders)
nem com qualquer fornecedor de tracker. Nomes, logos, arte, modelos e backends são
próprios. Detalhes em `REFERENCIA-TECNICA.md` → "O que é e o que não é reutilizável".