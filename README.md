# Arc GX

App desktop **Windows** que lê a tela do jogo por captura de GPU, identifica itens por
visão computacional + OCR e desenha um HUD sobre a janela do jogo.

Projeto **independente e de código próprio**. O Arc GX é um tracker para ARC Raiders
(Embark Studios) — usado aqui apenas em sentido nominativo, para dizer a que o app
se destina. Sem vínculo com a Embark ou com qualquer fornecedor de tracker.

Documento interno de decisões de engenharia: `docs/REFERENCIA-TECNICA.md`.
Procedência dos dados: `NOTICE.md`.

---

## Stack

| Camada | Escolha |
|---|---|
| Shell | **Electron 42** |
| UI | **Preact** + **Vite** (painel e HUD) |
| Nativos | **Rust / N-API** (`@napi-rs/cli`) — `wgc-capture` (WGC+D3D11) e `cell-vision` (OpenCV) |
| IA | **ONNX Runtime 1.30** com **DirectML** (fallback automático para CPU) |
| Dados | **data-release** endereçado por conteúdo (sha256), baixado de CDN |
| Persistência | `node:sqlite` + config JSON + token cifrado com `safeStorage` |
| Empacotamento | **electron-builder** (NSIS) + `electron-updater` |

## Dados do jogo

O app não embute nada: tudo vem de um **data-release** endereçado por sha256.

```bash
npm run data:all -- --out dados          # ingere das fontes públicas + publica
$env:ARC_DATA_RELEASE_URL = "file:///H:/Arcgxapp/build/release"
npm run dev
```

Fontes: `RaidTheory/arcraiders-data` (MIT — é a única com nome de item em 20
idiomas) e `ardb.app/api` (detalhe de item, quests, inimigos). Quem entra
primeiro ganha, então o ardb só preenche buraco e nunca sobrescreve tradução.

O `manifestId` é um hash do conteúdo: republicar o mesmo dado gera o mesmo id e
o cliente não baixa nada. `ATTRIBUTION.json` viaja junto dos dados e alimenta a
tela de créditos do painel — é exigência da licença, não cortesia.

Detalhes em `tools/data-ingest/README.md` e `tools/data-publisher/README.md`.
Procedência de cada tipo de dado em `NOTICE.md`.

## Dados: semente + correção

A semente pública chega defasada (53 dias na última medição — 41% dos itens do
build atual estavam faltando). Quem pode consertar não é o projeto, é quem usa:

1. semente pública cobre ~60% no dia um
2. ícone não reconhecido → o classificador devolve **"desconhecido"**, nunca chute
3. um toque no HUD nomeia o item
4. **3 instalações diferentes** com o mesmo nome aplicam sozinhas; abaixo disso
   entra na fila de moderação
5. o patch circulated por `GET /v1/patch` e é aplicado por cima da semente

Backend em `backend/` (Cloudflare Worker + D1, free tier). Premium por código,
gerado por você. **Reconhecimento de item nunca é premium** — premium vende
conveniência, não capacidade. Ver `backend/README.md`.

## Layout

```
apps/
  main/           processo Electron: janelas, IPC, capture, updater, store
    preload.cjs   ponte contextBridge (desktop:* e overlay:*)
  workers/        worker_threads: scan (ONNX), ocr, map
  renderer/
    desktop/      painel de configuração (Preact)
    overlay/      HUD (Preact)
packages/
  shared/         tipos, canais IPC, config, data-release, logger
  design/         tokens.css + components.css
  native/
    wgc-capture/  Rust: Windows Graphics Capture -> frames BGRA
    cell-vision/  Rust: OpenCV -> células + batch do classificador
docs/
  REFERENCIA-TECNICA.md   decisões de engenharia do Arc GX
  ARQUITETURA.md          visão geral da arquitetura
```

## Anti-cheat

O ARC Raiders roda **Easy Anti-Cheat**, **Denuvo Anti-Cheat** e **Anybrain**
(ML de telemetria de input), mais camadas próprias da Embark.

Por isso o Arc GX tem linhas vermelhas que **não são features**:

- ❌ nunca injeta input (`SendInput`, hooks)
- ❌ nunca lê ou escreve memória do processo do jogo
- ❌ nunca instala driver, serviço ou componente de kernel
- ❌ nunca faz automação de jogo
- ✅ lê só pixels da janela, como um gravador de tela
- ✅ captura **desligada por padrão** e pausa quando o jogo sai de foco

Modelo de ameaça completo em `docs/ANTICHEAT.md`. A tela **Privacidade** no
painel mostra isso ao usuário.

> O risco residual é real e é do usuário: nenhuma empresa publica o que as
> camadas da Embark medem. Se estiver em dúvida se um tracker é aceitável na
> sua conta, pergunte à Embark antes de usar.

## Começar

Pré-requisitos: **Node 22.12+**, **Rust stable**, e o toolchain MSVC no Windows
(para os addons nativos).

```bash
npm install
npm run build:shared
npm run dev          # terminal 1 (Electron)
npm run dev:renderer # terminal 2 (Vite, opcional)
```

Build dos addons nativos (opcional — o app roda sem eles, só perde captura/visão):

```bash
npm run build:native:wgc
npm run build:native:cell-vision
```

Instalador:

```bash
npm run dist         # release/Arc GX-<versão>-setup.exe
```

O `prebuild` copia o modelo do Tesseract de `node_modules` e avisa se a galeria
de embeddings não estiver presente — sem ela o app não quebra, ele apenas passa a
errar ~38% dos itens sem avisar.

## Variáveis de ambiente

| Var | Efeito |
|---|---|
| `ARC_DATA_RELEASE_URL` | Base do manifesto de dados/modelos (aceita `file://` para dev offline) |
| `ARC_UPDATE_FEED_URL` | Feed do `electron-updater` |
| `ARC_CAPTURE_HZ` | Hz de chegada dos frames |
| `ARC_SCAN_TARGET_HZ` | Hz da inferência de item |
| `ARC_WGC_CAPTURE_ADDON` | Caminho explícito do `.node` de captura |
| `ARC_CELL_VISION_ADDON` | Caminho explícito do `.node` de visão |
| `ARC_DESKTOP_DEV_URL` | URL do Vite no lugar do HTML buildado |
| `ARC_OVERLAY_DEV_URL` | idem para o HUD |
| `ARC_LOG_FILE` | Arquivo de log |
| `ARC_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Estado atual

Implementado e medido no jogo:

- **Captura** WGC + D3D11, com allowlist positiva de processo (`PioneerGame.exe`)
  e pausa quando a janela perde o foco
- **Grade de células** OpenCV calibrada por painel (MOCHILA `4x6`, USO RÁPIDO,
  BOLSO SEGURO, ARMAZENAMENTO)
- **Classificador** encoder ONNX próprio, com busca por cosseno, agrupamento de
  famílias de nível e recusa de pares galeria/ONNX divergentes
- **OCR** Tesseract local nos contadores e no total, com filtro de estabilidade
- **Overlay** click-through, badges dentro da célula, HUD de contadores
- **Dados** data-release endereçado por sha256, catálogo SQLite local
- **i18n** pt-BR/en para eventos, mapas, grupos e 182 subcategorias

Ainda não implementado: `EQUIPAMENTO` (geometria de cards com durabilidade é
diferente e continua fora do scan), card de origem/drop (o catálogo não tem esse
dado) e leitura de peso em kg (o Tesseract erra a vírgula decimal).

## Publicar uma release

O instalador vai para o **GitHub Releases**, e é ele que alimenta o autoupdate.
O repositório precisa ser público — repo privado devolve 404 para quem não tem
token, e o app não instala sozinho.

```bash
$env:GITHUB_TOKEN="github_pat_..."   # escopo: contents: write
.\tools\publicar-release.ps1         # monta e sobe latest.yml + blockmap + setup.exe
```

O owner/repo sai do remote `origin`; o script não tem o nome escrito dentro.
Para testar sem publicar nada:

```bash
.\tools\publicar-release.ps1 -DryRun
```

> **Developer Mode**: sem ele o `electron-builder` não consegue extrair o
> `winCodeSign` (o Windows recusa symlink) e o build morre. O script detecta
> isso e pula o `rcedit`, deixando o `Arc GX.exe` sem ícone e versão embutidos —
> o instalador e os atalhos saem normais. Ligar
> *Configurações › Sistema › Para desenvolvedores* resolve de vez.

Para apontar outro repositório sem reinstalar: **Configurações › Feed de
atualização** no painel. Vazio = usa o `app-update.yml` embutido no instalador.