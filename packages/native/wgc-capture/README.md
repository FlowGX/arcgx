# wgc-capture — captura de janela (Fase 2)

Addon N-API em Rust que faz **Windows Graphics Capture** e entrega frames BGRA
para o Node.

## Compilar

Requer **Visual Studio Build Tools** com o workload C++ (linker + Windows SDK).

```powershell
.\tools\build-native.ps1        # so o wgc-capture
.\tools\build-native.ps1 -All   # wgc-capture + cell-vision
```

O `build-native.ps1` carrega o `vcvars64` antes. Sem ele o cargo compila e
quebra na etapa de link com `linker 'link.exe' not found` — o Rust compila
sozinho, mas o linker e as libs do SDK so existem depois do vcvars.

## Testar

```bash
npm run capture:test
# ou
node tools/capture-smoke.mjs --frames 30 --timeout 20000
```

O teste abre o Notepad, captura a janela pelo WGC de verdade e confere que os
frames chegam com tamanho, buffer e conteudo coerentes. Não é mock.

> **O teste precisa rodar num terminal interativo do usuario.**
> Em sessão nao-interativa (servico, Session 0, agente headless) o
> `D3D11CreateDevice` falha com `E_INVALIDARG` ate em WARP — ver "Ambiente" abaixo.

## API

| Funcao | Descricao |
|---|---|
| `captureSupport()` | `{ windowsGraphicsCapture, d3D11, reason }` |
| `startCapture(hwnd)` | inicia; a janela precisa estar **visivel** |
| `stopCapture()` | fecha sessao, pool, device e staging |
| `isRunning()` | estado |
| `pollFrame()` | le e consome o frame mais recente (`null` se nao chegou) |
| `stats()` | frames, dropped, fps, tamanho, `lastError`, `vramMb` |
| `listWindows()` | janelas visiveis com titulo e rect |
| `isWindow` / `windowTitle` / `targetWindowRect` / `targetClientRect` | helpers Win32 |
| `windowHasForeground` / `isTargetForeground` / `focusGameWindow` | foco |
| `lastD3DError()` | detalhe da ultima falha de device (diagnostico) |

## Decisões que importam

### O frame não chega por callback

O addon guarda o último frame e o JS chama `pollFrame()`. Um
`ThreadsafeFunction` custaria ~120 MB/s de cópia a 15 Hz (1920×1080×4) e ainda
assim não evitaria o scan worker precisar ler o dado.

### Map e CopyResource vivem no DeviceContext

Não no device. E o `ID3D11DeviceContext` **não é thread-safe**: nesta
implementação só `process_frame` o toca, sempre na thread do WGC.

### Handler precisa sobreviver ao scope

Se o `TypedEventHandler` for descartado, o runtime remove a inscrição e a
captura morre sozinha. Ele é guardado dentro de `Capture`.

### Staging texture acompanha o resize

A janela pode mudar de tamanho entre frames; se `ContentSize()` divergir da
staging, ela é recriada antes do `CopyResource`.

### VRAM

O frame pool segura memória de vídeo enquanto vive. Por isso `stopCapture`
derruba pool, session e staging — sem isso o driver segura centenas de MB
mesmo com a janela fechada. `stats().vramMb` reporta a estimativa
(2 buffers do pool + 1 staging).

### Escada de criação do device

Não existe um único caminho válido: a GPU pode não suportar 11_1, e em máquina
sem driver utilizável só há WARP. O addon tenta

```
HARDWARE: 11_1 -> 11_0 -> 10_1 -> 10_0
WARP:     11_1 -> 11_0 -> 10_1 -> 10_0
```

e registra **todas** as tentativas em `lastD3DError()`. "WGC indisponível" sem
detalhe é impossível de diagnosticar.

## Ambiente: por que D3D11 falha em sessão não interativa

Medido nesta máquina (2026-10-11). `D3D11CreateDevice` retorna `E_INVALIDARG`
em **todas** as 8 combinações, incluindo WARP.

Isto **não é bug do addon**. Um teste em C puro com o SDK da Microsoft
(`H:\Arcgxapp-ref\d3dtest`) retorna exatamente os mesmos 8 `0x80070057`:

```
  ERRO  HARDWARE/11_1 = 0x80070057
  ERRO  HARDWARE/11_0 = 0x80070057
  ERRO  HARDWARE/10_1 = 0x80070057
  ERRO  WARP/11_1 = 0x80070057
  ERRO  WARP/11_0 = 0x80070057
  ERRO  WARP/10_1 = 0x80070057
```

WARP é render por software e sempre deveria funcionar. Ele falhar assim é
sintoma de processo fora de uma sessão de desktop interativa — que é o caso de
agente headless, serviço ou Session 0.

Tudo que é **Win32 puro** funciona normalmente no mesmo processo:
`listWindows()` devolve as janelas, `targetWindowRect` devolve o retângulo
correto, `isWindow` e `windowHasForeground` respondem. Só a criação do device
D3D11 é bloqueada.

**Consequência prática:** a validação do WGC precisa ser feita num terminal
interativo. Se o teste rodar lá e devolver frames, o caminho está validado.

## Verificação pendente

Rodar `npm run capture:test` em terminal interativo com o jogo aberto e
confirmar:

- [ ] `captureSupport()` devolve `true`
- [ ] `startCapture(hwndDoJogo)` roda sem erro
- [ ] `pollFrame()` entrega frames com o tamanho da janela
- [ ] o conteúdo do frame não é todo preto
- [ ] `stopCapture()` libera e `vramMb` zera