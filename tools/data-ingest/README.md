# Ingestão de dados do jogo

Puxa os dados das fontes configuradas, normaliza para o schema do Arc GX e
escreve a árvore de fonte que o `publish.mjs` consome.

```bash
node tools/data-ingest/ingest.mjs --out dados
node tools/data-ingest/ingest.mjs --out dados --sources raidtheory     # só uma fonte
node tools/data-ingest/ingest.mjs --out dados --no-details            # ~4x mais rápido
```

## Saída

```
dados/
  game/*.json          normalizado para packages/shared/src/game-schema.ts
  ATTRIBUTION.json     créditos — publicado junto com os dados
```

## Fontes

| id | origem | traz | atribuição |
|---|---|---|---|
| `raidtheory` | [`RaidTheory/arcraiders-data`](https://github.com/RaidTheory/arcraiders-data) (MIT) | 581 itens com nome em 20 idiomas, quests, skill nodes, projects, mapas, trades, bots, hideout | **obrigatória** |
| `ardb` | [`ardb.app/api`](https://ardb.app/api) | detalhe de item (`weight`, `stackSize`, `breaksInto`), quests narrativos, inimigos | não |

## Por que as duas

Nenhuma fonte sozinha serve:

- **raidtheory** é a única com tradução. Sem ela o painel multi-idioma não existe.
- **ardb** tem detalhe de item e inimigos que o raidtheory não expõe, e cobre
  itens que não estão lá.

A ordem importa: quem entra **primeiro** ganha. O raidtheory vem antes, então o
ardb só preenche buraco — nunca sobrescreve um nome traduzido por um inglês.

Resultado atual: **712 itens** (581 traduzidos + 131 só em inglês).

## Adicionar uma fonte

1. Crie `tools/data-ingest/sources/<id>.mjs` exportando `id`, `name`, `homepage`,
   `license`, `attribution` e as funções `items()` / `quests()` que quiser.
2. Registre em `SOURCES` no `ingest.mjs`.
3. Defina a posição no array `enabled` — antes = maior precedência.

A normalização para o schema fica em `lib/normalize.mjs` (`toTier`, `titleCase`,
`mergeById`, `fill`, `pool`, `fetchJson`).

## Créditos

`ATTRIBUTION.json` é gerado a partir do `attribution` de cada fonte e publicado
**junto** dos dados — o app baixa os dados de terceiros, então o crédito tem de
viajar com eles. O `publish.mjs` avisa se o arquivo estiver faltando.

No app, `desktop:get-credits` alimenta a tela de créditos, que marca com
"atribuição obrigatória" as fontes com `required: true`. Não é cosmético: sem
exibir aquilo, o uso do dado não está licenciado.

## Limites

- `ardb.app` devolve no máximo 500 itens, sem paginação. Não é bug da ferramenta.
- `ardb.app` não tem tradução — os itens que só existem lá ficam em inglês.
- GitHub sem token: 60 requisições/h na API de árvore. Os arquivos vão por
  `raw.githubusercontent.com`, que não tem limite. Com token, a ingestão fica
  mais estável em dia de patch grande do jogo.