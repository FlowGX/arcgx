# Referência técnica

Notas de engenharia do Arc GX — **documento interno do projeto**.
Não é uma análise de nenhum produto de terceiros.

---

## 1. Por que Electron

Um overlay de jogo precisa de três coisas que o Electron já entrega prontas:

- **Janela transparente, sempre no topo, sem foco e click-through** — o HUD não pode
  roubar o foco do jogo nem aparecer na Alt+Tab.
- **Acesso a frame nativo + composição em GPU** via Chromium.
- **empacotamento e auto-update** (`electron-builder` + `electron-updater`).

Custo: ~150 MB de runtime e ~120 MB de RAM. Aceitável porque o app precisa de um
painel de configuração completo (itens, raids, mapa, conta, sync) — escrever isso
em WinUI/WPF custaria muito mais em tempo de desenvolvimento.

Alternativas descartadas:
- **Tauri** — menor, mas o overlay transparente/click-through e o `safeStorage`
  custam mais para reproduzir, e o ecossistema de visão computacional é Node-first.
- **Overwolf/CEP** — exige aprovação da loja deles e acopla a distribuição.

## 2. Captura: Windows Graphics Capture (e não `desktopCapturer`)

`desktopCaptursor` do Electron tem dois problemas para overlay:

1. devolve **frames da tela composta**, então o próprio overlay apareceria na captura;
2. em janela em fullscreen exclusivo o resultado é preto.

`GraphicsCaptureItem` (WinRT) resolve os dois: dá acesso direto ao frame da janela
antes da composição, via DXGI. O caminho é:

```
HWND -> GraphicsCaptureItem -> Direct3D11CaptureFramePool
     -> Direct3D surface -> ID3D11Texture2D de staging
     -> IDXGIResource -> Map() -> bytes BGRA na memória do host
```

Requer um `IDirect3DDevice` no mesmo adapter da GPU que renderiza o jogo —
por isso o addon importa `d3d11.dll`, `dxgi.dll` e `dwmapi.dll`.

**Custo de VRAM:** o frame pool deve ter 1–2 frames e as texturas de staging, no
tamanho da janela do jogo (1920×1080×4 B ≈ 8 MB por textura). Não é problema, mas
o pool **precisa** ser destruído ao parar a captura, senão o driver segura VRAM.

**Alternativa de diagnóstico:** `startScreenCapture` captura o monitor inteiro —
mais lenta e inclui o overlay, mas serve para depurar quando o WGC falha.

## 3. Como clicar sem roubar o foco

O overlay é `setIgnoreMouseEvents(true, { forward: true })` — o clique atravessa
para o jogo. O problema é o oposto: quando o usuário quer interagir com o HUD.

Sequência usada:

1. o HUD detecta `mouseenter` num elemento e chama `overlay:set-interactive(true)`;
2. o main roda `setIgnoreMouseEvents(false)` + `setFocusable(true)`;
3. no `blur` da janela, reverte para click-through.

Para injetar um clique **dentro do jogo** a partir do HUD (ex.: usar um item),
o addon usa `SendInput` com coordenadas absolutas de tela, sem chamar
`SetForegroundWindow` — assim o foco continua no jogo.

## 4. Visão computacional: por que um addon em Rust

O caminho crítico por frame é:

```
frame BGRA -> recorte da ROI -> grayscale -> Canny -> findContours
           -> merge/filtragem -> recorte de cada célula -> resize + normaliza
           -> tensor (N, 3, 96, 96) pronto para o ONNX
```

Em JavaScript, percorrer 4 M pixels e alocar dezenas de `Uint8Array` por frame a
4 Hz gera pressão de GC suficiente para aparecer como engasgo no HUD. Em Rust com
OpenCV, o mesmo passo é ~1 ms e **zero alocação no GC do Node**.

Por isso existe `cell-vision`: o recorte e a normalização acontecem em código
nativo e o que atravessa a fronteira N-API já é o tensor final.

**Contrato do detector:** sempre devolve as células ordenadas da esquerda para a
direita, de cima para baixo. Lista vazia = inventário fechado.

## 5. ONNX Runtime: DirectML com fallback para CPU

`onnxruntime-node` 1.30 traz `DirectML.dll` (EP DML sobre DX12) no mesmo pacote.

Configuração e os dois ajustes que **não** são opcionais:

```js
{
  executionProviders: ['dml', 'cpu'],
  graphOptimizationLevel: 'all',
  executionMode: 'sequential',   // execuções concorrentes brigam pela VRAM
  enableMemPattern: false,       // padrão de memória para host quebra no device
  extra: { session: { 'dml.enable_mem_pattern': '0' } },
}
```

O OCR roda **sempre em CPU** (`executionProviders: ['cpu']`): os modelos são
pequenos (4–16 MB) e o custo de transferências GPU↔CPU supera a inferência.
O classificador de item usa DML, onde o ganho é real (embeddings grandes).

Fallback: se `InferenceSession.create` falhar com DML, o worker captura o erro,
marca `provider = 'cpu'`, descarta as sessões e recria. Isso mantém o app
funcionando em máquina sem GPU compatível, com um log de aviso.

### Budget de VRAM (3060 12 GB, jogo em uso)

| Bloco | Peso |
|---|---|
| Jogo | 4–6 GB |
| ORT DML (embedder f32) | ~1,5 GB |
| Frame pool WGC + staging | ~50 MB |
| HUD Chromium | ~300 MB |
| **Total** | **~8 GB** |

Variantes `*_fp16.onnx` cortam o pico pela metade quando a GPU está apertada —
vale sempre publicar os dois flavors no data-release e escolher em runtime.

## 6. Data release endereçado por conteúdo

Modelos ONNX passam de 150 MB. Embutir no instalador significa reinstall a cada
retreino. O formato escolhido:

```
current.json                      -> { schema, manifestId, publishedAt, files, optional }
objects/<sha256><ext>             -> blobs, dedupe por conteúdo
releases/<manifestId>/…           -> montagem final
```

`current.json` é minúsculo; o cliente baixa só o que não tem, confere sha256 e
monta com hardlink. Publicar modelo novo = subir um manifest novo.
`ARC_DATA_RELEASE_URL` aceita `file://`, o que permite rodar 100% offline em dev.

**Grupos opcionais** (`optional`) não são baixados por padrão: OCR, por exemplo,
só é baixado se `ocrEnabled`.

## 7. Por que Preact e não React

O HUD atualiza a 15 Hz com pouca DOM. Preact tem ~4 KB de runtime contra ~45 KB
do React, e a API de hooks é idêntica — o custo de escolha é quase zero.
Com Leaflet e lucide, o bundle do painel fica em ~16 KB (gz 6,6 KB).

## 8. Persistência

| Dado | Onde | Por quê |
|---|---|---|
| Config | `arcgx-config.json` | legível, editável, backup trivial |
| Sessão | `secrets.json`, cifrado com `safeStorage` | DPAPI do Windows; sem a chave do usuário, ilegível |
| Banco | `arcgx.sqlite` (`node:sqlite`) | built-in do Node 22+, zero binding nativo |
| Modelos/dados | data-release | ver seção 6 |

O `node:sqlite` evita uma dependência nativa (better-sqlite3 exigiria recompilar
para cada arquitetura e quebraria o `npmRebuild: false` do electron-builder).

## 9. IPC: um canal por ação, sem wildcard

No app de referência são 113 canais; aqui, bem menos. Regras:

- nome `<janela>:<ação>`, declarado uma única vez em `packages/shared/src/channels.ts`;
- tipos em `packages/shared/src/api.ts`, com `on*()` devolvendo a função de
  cancelamento (evita listener leak no StrictMode/double-mount);
- `contextIsolation: true`, `nodeIntegration: false`, e o preload nunca expõe
  `ipcRenderer` cru — só as funções nomeadas.

---

## O que é e o que não é reutilizável

Este projeto é **independente**. O Arc GX é software próprio.

**Pode usar** (licenças livres):
Electron (MIT) · Preact (MIT) · Leaflet (BSD-2) · lucide (ISC) · OpenCV (Apache-2.0) ·
ONNX Runtime e DirectML (MIT) · PaddleOCR (Apache-2.0) · crates `windows`/`napi` (MIT).

**Precisa ter licenses própria:**
qualquer `.onnx` de terceiro (pesos são do autor), qualquer base de dados extraída
de jogo fechado, qualquer arte, logo, nome de produto alheio.

**Não usar:** backends, endpoints, CDNs, nomes de pacote ou marcas de produtos de
terceiros. O Arc GX fala apenas com `cdn.arcgx.app` (nosso) e com o backend que
a gente mesmo subir.

**Sobre o jogo:** "ARC Raiders" é nome de jogo da Embark Studios. Citar o nome do
jogo para descrever a que o app se destina é uso nominativo e normal; o Arc GX é
um projeto sem vínculo com a Embark ou com qualquer fornecedor de tracker.

Os `.onnx` do Arc GX serão **nosso**, treinados a partir de capturas que o próprio
usuário produz. Nada de download de pesos de terceiros.

---

## Estado das fases

| Fase | Status |
|---|---|
| 1 — esqueleto | ✅ janelas, IPC, config, store, updater, data-release |
| 2 — captura | ✅ addon Rust compilado; **validação do WGC pendente** (bloqueada por D3D11 em sessão não interativa) |
| 3 — visão | ⬜ cell-vision |
| 4 — inferência | ⬜ scan-worker ONNX |
| 5 — OCR | ⬜ ocr-worker |
| 6 — HUD | ✅ estrutura (badges, prompt de item desconhecido) |
| 7 — serviço | ✅ backend Worker+D1, patch, premium por código |

## Roadmap

1. **Esqueleto** — janelas, IPC, config, store, updater, data-release. ✅
2. **Captura** — `wgc-capture`: HWND → frames BGRA, destroy pool no stop.
3. **Visão** — `cell-vision`: Canny + `findContours` + batch normalizado.
4. **Inferência** — `scan-worker`: slot detector → embedder → galeria → tier.
5. **OCR** — `ocr-worker` (PaddleCPU) + fallback para Windows OCR.
6. **HUD** — badges, cartão de item, mapa com pins, busca.
7. **Serviço** — API REST própria + data-release em CDN + auto-update.