# NOTICE — procedência dos dados

Este projeto distribui duas categorias de dado com origens diferentes. A
distinção importa e está registrada aqui.

---

## 1. Código

Todo o código do Arc GX é próprio e original.

Dependências de terceiros são usadas sob as respectivas licenças livres
(veja `docs/REFERENCIA-TECNICA.md` → "O que é e o que não é reutilizável").
`NOTICE` e os textos de licença das dependências são gerados nao build.

---

## 2. Dados do jogo (`game/*.json`)

Os arquivos em `game/` são **dados do jogo ARC Raiders, publicado pela Embark
Studios**. Não são criação do Arc GX e não são republicados pelo Arc GX:
eles são obtidos de fontes públicas durante a ingestão e transformados no
formato do Arc GX.

### Fontes

| Fonte | Licença | Uso |
|---|---|---|
| [`RaidTheory/arcraiders-data`](https://github.com/RaidTheory/arcraiders-data) | MIT | itens (com nome em 20 idiomas), quests, skill nodes, projects, mapas, trades, bots, hideout |
| [`ardb.app/api`](https://ardb.app/api) | ver termos no site | detalhe de item, quests, inimigos |

O repositório MIT exige atribuição. O Arc GX cumpre isso na tela de créditos
(`Créditos` no painel), que é montada a partir do `ATTRIBUTION.json` publicado
junto com os dados. As entradas com `required: true` são marcadas como
obrigatórias e não podem ser ocultadas.

### Responsabilidade pelo conteúdo

Todo o conteúdo de jogo — nomes, descrições, valores, raridades — é
**© Embark Studios AB**. A redistribuição desses dados dentro dos nossos pacotes
de release é uma decisão de produto, não uma afirmação de titularidade. O Arc GX
é um projeto sem vínculo com a Embark Studios e sem endosso deles.

> Para gerar o `ATTRIBUTION.json` e a árvore de dados:
> `npm run data:all`. Para trocar a fonte: `--sources raidtheory` ou `--sources ardb`.

---

## 3. Modelos de visão (`.onnx`)

Os pesos em `models/` são **treinados pelo Arc GX**, a partir de capturas
produzidas pelo próprio usuário. Nenhum peso de terceiro é redistribuído.

A pipeline de treino é:

```
captura do usuario -> recorte de celula -> rotulo (confirmado no app)
                    -> treino -> export ONNX -> publicacao no data-release
```

O usuário que contribui com captura para treino precisa saber disso: a tela dele
vira dado de treino. O app deve pedir consentimento explícito antes de enviar
qualquer frame, e o texto precisa dizer que aquilo vira parte de um modelo
distribuído.

### Base de conhecimento e o papel do usuário

Quando o classificador não reconhece um ícone, o Arc GX oferece ao usuário dar o
nome. Essa correção é enviada ao backend do Arc GX e, após consenso de três
instalações independentes ou aprovação na moderação, passa a valer para todos.

Ou seja: **o conteúdo que a comunidade escreve é do usuário e é publicado pelo
Arc GX.** Isso é diferente de extrair dados do jogo — é conteúdo gerado por
pessoa. Ainda assim é conteúdo sobre o jogo, e vale a mesma ressalva da seção 2
quanto à titularidade do jogo em si.

---

## 4. Mapas e tiles

Tiles de mapa e arte de mapa **não** estão neste repositório nem no data-release
padrão. Se forem gerados a partir de material do jogo, valem a mesma ressalva da
seção 2. Os pins marcados pela comunidade (sugestões de posição) são conteúdo
dos usuários, não do jogo.