# Publisher do data-release

Gera o manifesto endereçado por conteúdo e monta a árvore de release local.
Depois é só subir `<out>` para um CDN estático.

## Uso

```bash
node tools/data-publisher/publish.mjs --src dados --out build/release
node tools/data-publisher/publish.mjs --src dados --out build/release --ocr --clean
node tools/data-publisher/publish.mjs --src dados --out build/release --dry-run
```

## Layout da fonte

```
dados/
  game/     items.json, containers.json, quests.json, research.json, ...
  models/   *.onnx, *.f32, *.bin, *.json
  ocr/      modelos do PaddleOCR (grupo opcional)
```

Só entram no release arquivos `.json .onnx .f32 .bin .txt`.

## O que ele faz

1. Calcula o sha256 de cada arquivo.
2. Deriva o `manifestId` = hash da lista `(caminho, sha256)` dos arquivos obrigatórios.
   **Determinístico**: publicar o mesmo conteúdo de novo gera o mesmo id e o
   cliente não baixa nada.
3. Grava cada blob em `data/<sha256><ext>` — é exatamente o caminho que o
   cliente busca via `manifest.files[].key`.
4. Monta `releases/<manifestId>/…` com hardlink (cai para cópia se falhar):
   espelho legível dos mesmos arquivos.
5. Escreve `current.json`.

`--ocr` coloca os modelos de OCR em `optional["paddle-ocr"]`, que o app só
baixa se `ocrEnabled` estiver ligado.

## Testar sem servidor

O cliente aceita `file://`:

```bash
$env:ARC_DATA_RELEASE_URL = "file:///H:/Arcgxapp/build/release"
npm run dev
```

## Publicar

```bash
aws s3 sync build/release s3://cdn.arcgx.app/data/ --delete
# ou rclone / wrangler r2 / qualquer CDN estático
```

Feed do auto-update (separado):

```bash
$env:ARC_UPDATE_FEED_URL = "https://cdn.arcgx.app/releases"
```