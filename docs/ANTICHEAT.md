# Anti-cheat: modelo de ameaça e limites do Arc GX

> Este documento existe porque a decisão errada aqui **derruba a conta do
> usuário**. Ele define o que o Arc GX faz, o que ele nunca vai fazer, e por quê.
>
> Stack do ARC Raiders em 2026-10: **Easy Anti-Cheat** (kernel) ·
> **Denuvo Anti-Cheat** · **Anybrain/Cerebro** (ML de telemetria de input) ·
> camadas próprias da Embark não reveladas.

---

## 1. A regra de ouro

> **Nunca injetar input. Nunca tocar no processo do jogo.**

Tudo que o Arc GX faz é **observar pixels** que o próprio Windows já entrega
para qualquer gravador de tela. Isso é a mesma superfície de API do OBS, do
Steam Game Capture, do Discord e do NVIDIA ShadowPlay.

O que separa um tracker de um cheat não é o que ele lê — é o que ele **faz**.

---

## 2. Linhas vermelhas — o Arc GX nunca vai fazer

Estas não são-features. Não vão ser implementadas, nem "só por trás de flag":

| ❌ Proibido | Por quê |
|---|---|
| `SendInput` / `mouse_event` / `keybd_event` | **Anybrain modela telemetria de input por ML.** Input sintético é a assinatura de macro/aimbot. Risco máximo. |
| `SetWindowsHookEx`, hooks em DLL do jogo | injeção de código no processo do jogo |
| `OpenProcess` + `ReadProcessMemory` | leitura de memória do processo |
| `WriteProcessMemory`, `VirtualAllocEx` | escrita/injeção no processo |
| Driver de kernel, SSDT, hypervisor hooking | fora de escopo e de講 legal |
| Bypass de detecção, ocultação de processo | agrava tudo |
| Overlay que injete no DirectX/Vulkan do jogo | hook no renderizador |
| Automação de jogo (aim, movement, loot) | isso é cheat |

A referência (`deliverClicksWithoutActivation`) usava `SendInput`. **Removido.**
A interface TypeScript e o addon Rust não têm mais essa função.

---

## 3. O que o Arc GX faz (e é aceitável)

| ✅ Permitido | API | Por que não é cheat |
|---|---|---|
| Capturar a janela | `GraphicsCaptureItem` (WinRT) | API pública documentada do Windows; é o que o OBS usa |
| Criar device D3D11 | `D3D11CreateDevice` | qualquer app gráfico faz |
| Enumerar janelas | `EnumWindows` | precisa achar a janela do jogo |
| Saber se está em foreground | `GetForegroundWindow` | para pausar o scan |
| Processar pixels em memória própria | OpenCV + ONNX local | é a imagem, não o processo |
| OverlayHSL próprio | `BrowserWindow` transparente | não injeta nada no jogo |
| OCR dos frames | PaddleOCR local | idem |

**Nunca abrimos handle no processo do jogo.** Capturamos a *janela*, não o
*processo*. A diferença importa: handle de processo é o que EAC/DAC inspecionam.

---

## 4. Por que ainda existe risco residual

Sendo honesto, porque zero risco não existe aqui:

- **Denuvo Anti-Cheat** é conhecido por bloquear e/ou dar falso positivo em
  overlays e ferramentas de terceiros. A documentação dele diz "detecta ou
  **bloqueia processos interferentes**". Um app externo que desenha por cima da
  janela do jogo é, pela letra, um candidato.
- **Arc GX é distribuído.** Uma cópia binária nossa em Json rodando na mesma
  máquina que o jogo é um artefato conhecido. Ferramentas anônimas não são.
- As camadas da Embark não são reveladas. Não sabemos o que elas medem.

**O que não sabemos:** se o DAC旗ra um app *leitor de tela*, *overlay* ou só
*overlay com input*. Não há como testar isso sem arriscar a conta.

---

## 5. Mitigações que o app implementa

### Captura é opt-in e desligada por padrão

`scannerCaptureEnabled` começa `false`. Nada é capturado até o usuário ligar
explicitamente. O app não tenta descobrir a janela do jogo sozinho.

### Pausa quando o jogo não está em foco

`isTargetForeground()` falso → o scan pausa. Não Capturamos o jogo em segundo
plano, e não gastamos VRAM.

### Overlay mostra o que está acontecendo

O HUD é visível por padrão (`overlayVisible: true`) e a tela de status mostra
`captura ativa/inativa`. Nada escondido.

### Sem driver, sem admin

O app roda em `asInvoker` (sem elevação) e não instala nada no sistema.

---

## 6. Decisões de produto que decorrem disso

1. **Nada de automação de jogo.** Sem "clique automático para loot", sem
   "macro de abertura de container". É onde trackers viram cheat e é proibido.
2. **Sem overlay interativo sobre o jogo.** O HUD é leitura. Se o usuário
   precisar interagir, a interação é com o **painel**, não com o jogo.
3. **Sem hotkeys globais que conflitem com o jogo.** O Arc GX usa
   `Alt+X` / `Alt+Shift+X`, que não colidem com binds comuns.
4. **Se o Embark banir overlays de terceiros, o Arc GX sai junto.** Não vamos
   tentar contornar.

---

## 7. O que o usuário precisa saber

Transparência é o mínimo. O app deve mostrar, na tela de créditos/diagnóstico:

```
Arc GX não injeta input, não lê memória do jogo e não modifica o processo.
Ele apenas lê os pixels da janela, como um gravador de tela.

Se você não tiver certeza se um tracker é aceitável no seu servidor,
pergunte à Embark antes de usar.
```

**A conta é do usuário.** Se a decisão de usar um tracker externo for arriscada
para ele, a resposta é não usar — e isso não é culpa do Arc GX, é o risco de
ferramentas de terceiros em jogos com 4 camadas de anti-cheat.

---

## 8. Checklist antes de publicar

- [ ] `npm run capture:test` passa em terminal interativo
- [ ] nenhum `SendInput`/`hook`/`ReadProcessMemory` no binário
- [ ] `scannerCaptureEnabled` default `false`
- [ ] aviso de transparência visível no app
- [ ] nenhuma feature de automação no roadmap
- [ ] política de privacidade descrevendo que frames ficam só na máquina