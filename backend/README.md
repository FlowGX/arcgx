# Backend de dados — Arc GX

Cloudflare Worker + D1, **plano gratuito**. Guarda só o que o usuário corrige;
o dado bruto do jogo continua vindo das fontes públicas via data-release.

Custo zero no free tier: Workers 100k req/dia · D1 5M leituras e 100k escritas/dia.
Para um tracker com base de usuários pequena, sobra com folga.

---

## Por que o backend existe

A semente (fonte pública) chega defasada — hoje, 53 dias. Quem pode consertar não
é o projeto, é quem está usando. Então o app oferece nomear o ícone que ele não
reconhece, e essa correção vira patch para todo mundo.

Sem backend, a base nunca converge.

## Setup

```bash
cd backend
npm install

# 1. criar o D1 (uma vez)
npx wrangler d1 create arcgx
#    -> copie o database_id para o wrangler.toml

# 2. schema
npm run db:init:local     # desenvolvimento
npm run db:init           # produção

# 3. segredo de admin
npx wrangler secret put ADMIN_TOKEN

# 4. subir
npm run dev               # http://localhost:8787
npm run deploy
```

O app fala com o backend pela variável `ARC_BACKEND_URL` (padrão:
`https://arcgx-data.<sub>.workers.dev`).

---

## Consenso e spam

Uma correção não entra sozinha. Duas etapas:

1. **sinal** — o usuário contou que aquele item existe com aquele valor
2. **consolidação** — **3 instalações diferentes** com o mesmo valor aplicam sozinhas

Abaixo disso vai para `report` e espera moderação. Sem isso, um usuário Introducing
valor errado contamina a base inteira.

Proteções em vigor:

| Limite | Valor |
|---|---|
| intervalo entre correções | 20 s |
| correções por instalação/dia | 200 (free: cota menor, no app) |
| tamanho do valor | 200 caracteres |
| `item_id` | `^[a-z0-9_.-]{2,80}$` |

---

## Premium

Sem cobrança automática. Você gera códigos e distribui:

```bash
curl -X POST https://arcgx-data.<sub>.workers.dev/v1/admin/codes \
  -H 'x-arcgx-token: SEU_TOKEN' \
  -H 'content-type: application/json' \
  -d '{"count": 20, "note": "beta acesso antecipado", "days": 90, "maxUses": 1}'
```

Formato do código: `GX-XXXX-XXXX-XXXX` (alfabeto sem caracteres ambíguos).

No app: `GET /v1/entitlement?install=<id>` devolve o plano; `POST /v1/entitlement/redeem`
ativa. Reativar um código **não** empurra a data de expiração que já estava correndo.

### O que o premium destrava

| Recurso | Free | Premium |
|---|---|---|
| **Reconhecimento de item** | ✅ | ✅ |
| HUD, OCR, mapa, stash local | ✅ | ✅ |
| Correções enviadas/dia | 50 | 2000 |
| Sync de progresso e stash entre PCs | ❌ | ✅ |
| Histórico de raids valorizado | ❌ | ✅ |
| Envio automático de correções | ❌ | ✅ |

Decisão de projeto: **reconhecimento de item nunca é premium.** Travar leitura de
tela atrás de assinatura é exatamente o que a gente decided não fazer. Premium
vende conveniência, não capacidade.

---

## Rotas

### Público

| Rota | Descrição |
|---|---|
| `GET /v1/health` | status e contagem de correções |
| `GET /v1/patch?since=<iso>` | correções consolidadas (incremental) |
| `GET /v1/items/:id` | estado de um item |
| `POST /v1/items/:id` | envia correção `{ field, value, locale, note? }` |
| `GET /v1/signals` | o que a comunidade está vendo (≥2 reports) |
| `GET /v1/entitlement?install=<id>` | plano |
| `POST /v1/entitlement/redeem` | ativa código |

### Admin (header `x-arcgx-token`)

| Rota | Descrição |
|---|---|
| `POST /v1/admin/codes` | gera códigos |
| `GET /v1/admin/queue?status=pending` | fila de moderação |
| `POST /v1/admin/queue/:id/approve` | aprova |
| `POST /v1/admin/queue/:id/reject` | rejeita |

---

## Modelo de dados

```
correction       item_id + field + locale -> valor  (peso = nº de confirmações)
item_signal      o que a comunidade está vendo hoje
report           fila de moderação
install          instalações conhecidas
subscription     plano por instalação
entitlement      códigos premium
```

`correction` guarda **um valor por (item, campo, idioma)** — snapshot, não histórico.
O histórico de quem mudou o quê está em `report`.

---

## Ligar o data-release

O patch da comunidade e a semente são coisas separadas:

```
data-release (CDN)          backend (D1)
  game/items.json      +      GET /v1/patch
  game/quests.json     ->     aplicado por cima em memória
  ATTRIBUTION.json
```

O app baixa os dois e combina. Se o backend cair, o tracker continua funcionando
com a semente — a rede do patch é melhoria, nunca requisito.