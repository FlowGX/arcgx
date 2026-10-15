# Publica uma release do Arc GX no GitHub Releases.
#
# ## ## ## Por que um script e nao `electron-builder --publish`
#
# Nao ha `gh` nesta maquina, e `electron-builder --publish provider=github`
# exige `token` no config ou `GH_TOKEN` no ambiente. O caminho da API nao
# precisa de `gh`: cria a release e sobe os tres arquivos que o
# `electron-updater` le (`latest.yml`, `blockmap` e o instalador).
#
# O owner/repo vem do remote do git, nao de uma constante aqui. O repositorio
# do Arc GX ainda nao existe; quando for criado, este script passa a funcionar
# sem edicao.
#
# Uso:
#   .\tools\publicar-release.ps1 -DryRun
#   $env:GITHUB_TOKEN='github_pat_...'  # precisa de `contents: write`
#   .\tools\publicar-release.ps1

[CmdletBinding()]
param(
  # Compila e monta o instalador, mas nao sobe nada.
  [switch]$DryRun,

  # Tags sem `v`. Padrao: a versao do package.json.
  [string]$Version,

  # Sobrescreve a deteccao do remote do git.
  [string]$Repo
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$raiz = Split-Path -Parent $PSScriptRoot
$saida = Join-Path $raiz 'release'

# ## ## ## Por que uma funcao e nao um Get-ItemProperty direto
#
# A chave so existe quando o Developer Mode ja foi ligado uma vez. Com
# `Set-StrictMode -Version Latest`, ler a propriedade de um objeto que nao a
# tem lanca `PropertyNotFoundStrict` e aborta o script inteiro — o oposto do
# que um `if` defensivo deveria fazer.
function Test-DevMode {
  try {
    $v = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction Stop
    if ($null -eq $v) { return $false }
    if (-not $v.PSObject.Properties['AllowDevelopmentWithoutDevLicense']) { return $false }
    return [int]$v.AllowDevelopmentWithoutDevLicense -eq 1
  }
  catch { return $false }
}

# ------------------------------------------------------------------ repo

if (-not $Repo) {
  $remote = git -C $raiz remote get-url origin 2>$null
  if (-not $remote) {
    throw @'
Nao ha remote `origin` neste repositorio.

Crie o repositorio no GitHub e conecte:

  git init
  git remote add origin https://github.com/SEU-USUARIO/arcgx.git

Ou passe o repo direto, sem criar remote ainda:

  .\tools\publicar-release.ps1 -Repo SEU-USUARIO/arcgx
'@
  }

  # Aceita tanto https://github.com/o/r.git quanto git@github.com:o/r.git
  if ($remote -match 'github\.com[:/](?<o>[^/]+)/(?<r>[^/]+?)(?:\.git)?$') {
    $Repo = "$($Matches.o)/$($Matches.r)"
  }
  else {
    throw "Remote nao parece ser do GitHub: $remote"
  }
}

Write-Host "Repositorio: $Repo" -ForegroundColor Cyan

# --------------------------------------------------------------- versao

if (-not $Version) {
  $pkg = Get-Content (Join-Path $raiz 'package.json') -Raw | ConvertFrom-Json
  $Version = $pkg.version
}
$tag = "v$Version"
Write-Host "Tag: $tag" -ForegroundColor Cyan

# ----------------------------------------------------------------- build

Write-Host "`nCompilando..." -ForegroundColor Cyan
Push-Location $raiz
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'build falhou' }

  # O electron-builder le `${env.UPDATE_REPO}` do yml para montar o app-update.yml.
  $env:UPDATE_REPO = $Repo

  # ## ## ## Developer Mode / admin
  #
  # O `winCodeSign` vem com symlinks, e o Windows so permite criar symlink com
  # Developer Mode ligado ou em terminal admin. Sem isso, o 7z falha e o
  # empacotamento inteiro morre — sem nada a ver com o projeto.
  #
  # Detectamos antes, em vez de esperar o erro e tentar adivinhar depois.
  $devMode = Test-DevMode
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

  $argsBuilder = @('--win', '--publish', 'never')
  if (-not $devMode -and -not $isAdmin) {
    Write-Host @'

Sem Developer Mode e sem admin: pulando o rcedit (--config.win.signAndEditExecutable=false).

  O QUE ISSO MUDA: o "Arc GX.exe" sai sem icone e sem versao embutidos.
  O icone do instalador e do atalho continuam normais, e o app funciona igual.

  Para ter o exe completo, ligue o Developer Mode
  (Configuracoes > Sistema > Para desenvolvedores) e rode de novo.

'@ -ForegroundColor Yellow
    $argsBuilder += '--config.win.signAndEditExecutable=false'
  }

  npx electron-builder @argsBuilder 2>&1 |
    Tee-Object -Variable saidaBuilder |
    Out-Host

  if ($LASTEXITCODE -ne 0) {
    $log = $saidaBuilder -join "`n"

    # O 7z do electron-builder extrai o winCodeSign com symlinks. Sem Developer
    # Mode e sem admin, o Windows recusa, e a mensagem que chega e
    # "Cannot create symbolic link : O cliente nao tem o privilegio necessario"
    # — que nao tem nada a ver com o projeto e passa horas de confusao.
    if ($log -match 'symbolic link' -or $log -match 'privilegio necessario') {
      throw @'
O empacotamento parou ao extrair o winCodeSign.

Causa: o Windows so deixa criar symlink com Developer Mode ligado ou com o
terminal em modo administrador. Este terminal NAO e administrador e o Developer
Mode esta desligado.

Resolva uma das duas:

  1. Ligar o Developer Mode (uma vez, precisa de admin):
     Configuracoes > Sistema > Para desenvolvedores > Modo de desenvolvedor

  2. Rodar este script num terminal como administrador.

Depois, limpe o cache quebrado e rode de novo:

  Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
'@
    }

    throw "electron-builder falhou. Veja as linhas acima."
  }
}
finally {
  Pop-Location
}

# ------------------------------------------------------------ artefatos

$artefatos = @(
  (Join-Path $saida 'latest.yml')
  (Join-Path $saida '*.blockmap')
  (Join-Path $saida "*-$Version-setup.exe")
)

$faltando = @()
foreach ($padrao in $artefatos) {
  $achou = @(Get-ChildItem -Path $padrao -ErrorAction SilentlyContinue)
  if ($achou.Count -eq 0) { $faltando += (Split-Path -Leaf $padrao) }
  else {
    $achou | ForEach-Object {
      # KB para o `latest.yml`, que tem menos de 1 KB e aparecia como "0 MB".
      $tam = if ($_.Length -lt 1MB) { '{0:N0} KB' -f ($_.Length / 1KB) } else { '{0:N1} MB' -f ($_.Length / 1MB) }
      Write-Host "  ok  $($_.Name)  $tam"
    }
  }
}

if ($faltando.Count) {
  throw @"
Faltaram artefatos em `release/`: $($faltando -join ', ')

O `latest.yml` e o `.blockmap` sao obrigatorios: sem blockmap o
electron-updater baixa o instalador inteiro, e sem `latest.yml` ele nem
descobre que existe versao nova.
"@
}

if ($DryRun) {
  Write-Host "`nDryRun: build ok, nada foi publicado." -ForegroundColor Yellow
  Write-Host "Para publicar, abra um terminal novo e rode:"
  Write-Host '  $env:GITHUB_TOKEN="github_pat_..."'
  Write-Host '  .\tools\publicar-release.ps1'
  exit 0
}

# ------------------------------------------------------------------ token

$token = $env:GITHUB_TOKEN
if (-not $token) { throw 'Defina GITHUB_TOKEN com um PAT de escopo `contents: write`.' }

# ## ## ## TLS 1.2 na mao
#
# O PowerShell 5.1 no Windows 10 antigo continua com TLS 1.0 como default, e o
# GitHub so aceita 1.2+. Sem esta linha a falha aparece como
# "The request was aborted: Could not create SSL/TLS secure channel", que nao
# menciona GitHub nem token — e leva a conclusão errada de que o PAT é inválido.
[Net.ServicePointManager]::SecurityProtocol = `
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$headers = @{
  Authorization = "Bearer $token"
  Accept        = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'  = 'arcgx-publish'
}

# -------------------------------------------------- cria a release (ou pega)

$api = "https://api.github.com/repos/$Repo/releases"

Write-Host "`nProcurando release $tag..." -ForegroundColor Cyan
$release = $null
try {
  $release = Invoke-RestMethod -Uri "$api/tags/$tag" -Headers $headers -Method Get
  Write-Host "Release ja existe (id $($release.id))." -ForegroundColor Yellow
}
catch {
  # ## ## ## 404 aqui e o caminho normal
  #
  # `Invoke-RestMethod` lanca uma excecao generica, e a de "nao achou" e
  # esperada na primeira vez. Tratar so 401/403 como erro de token evita
  # mascarar um PAT sem escopo como "release nao encontrada".
  $status = 0
  try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = 0 }

  if ($status -eq 401 -or $status -eq 403) {
    throw @"
Token recusado pelo GitHub (HTTP $status).

Verifique:
  - o PAT nao expirou
  - Repository permissions > Contents = Read and write
  - Repository access inclui o repositorio $Repo

Um PAT sem escopo aparece aqui como 404 no `git push` e 403 na API, nunca
como mensagem de permissao clara.
"@
  }

  Write-Host "Criando release..." -ForegroundColor Cyan
  $body = @{
    tag_name     = $tag
    name         = "Arc GX $Version"
    body         = "Instalador e metadados de atualizacao da versao $Version."
    draft        = $false
    prerelease   = $false
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Uri $api -Headers $headers -Method Post -Body $body -ContentType 'application/json'
}

# ------------------------------------------------------------------ upload

# ## ## ## Por que `curl.exe` e nao `Invoke-RestMethod`
#
# O PS 5.1 manda `[byte[]]` com `Transfer-Encoding: chunked` em vez de
# `Content-Length`, e o endpoint de upload de asset do GitHub responde 404
# nesse caso — sem corpo de erro, sem mencao a encoding. O token estava
# perfeito (`permissions.admin = True`); era o cliente HTTP.
#
# `curl.exe` vem no Windows 10 1803+ e monta a requisicao corretamente. Se
# faltar, o erro passa a ser explicito em vez de um 404 sem pista.
function Assert-Curl {
  if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    throw @'
curl.exe nao encontrado.

Este Windows e anterior a 10 1803, ou o curl foi removido. Instale o curl ou
suba os arquivos pela interface do GitHub:

  https://github.com/FlowGX/arcgx/releases/edit/<tag>
'@
  }
}

Assert-Curl

Write-Host "`nSubindo artefatos..." -ForegroundColor Cyan

foreach ($arquivo in @(
    Get-ChildItem -Path (Join-Path $saida 'latest.yml') -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $saida '*.blockmap') -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $saida "*-$Version-setup.exe") -ErrorAction SilentlyContinue
  )) {
  if (-not $arquivo) { continue }

  $tam = if ($arquivo.Length -lt 1MB) { '{0:N0} KB' -f ($arquivo.Length / 1KB) } else { '{0:N1} MB' -f ($arquivo.Length / 1MB) }
  Write-Host "  subindo $($arquivo.Name) ($tam)..."

  # ## ## ## `upload_url`, e nao `api.github.com`
  #
  # O GitHub documenta que o upload de asset **nao** vai para `api.github.com`.
  # A URL de upload vem no proprio release, em `upload_url`, no host
  # `uploads.github.com`, e ainda no formato de template:
  #
  #   https://uploads.github.com/repos/O/R/releases/ID/assets{?name,label}
  #
  # Postar em api.github.com responde 404 "Not Found" com token perfeito,
  # `permissions.admin = True` e release valida — foi exatamente o que
  # aconteceu, e custou duas hypotheses erradas antes.
  #
  # `{?name,label}` e uma URI template do RFC 6570: o bloco entre chaves e a
  # parte que se expande com os parametros. Tem que sair inteira, inclusive as
  # chaves.
  #
  # ## ## ## Por que o array de argumentos
  #
  # Invocar curl com string interpolada quebra em nome de arquivo com espaco
  # — e o instalador tem espaco ("Arc GX-0.1.0-setup.exe"). O array passa cada
  # item como argumento separado, sem reinterpretacao.
  $nomeAsset = [uri]::EscapeDataString($arquivo.Name)
  $url = $release.upload_url -replace '\{[^}]*\}', "?name=$nomeAsset"

  $saidaCurl = & curl.exe -sS -w '%{http_code}' -o NUL `
    -X POST `
    -H "Authorization: Bearer $token" `
    -H "Accept: application/vnd.github+json" `
    -H "X-GitHub-Api-Version: 2022-11-28" `
    -H "Content-Type: application/octet-stream" `
    --data-binary "@$($arquivo.FullName)" `
    $url 2>&1

  $status = ($saidaCurl | Select-Object -Last 1)

  if ($status -eq '201') {
    Write-Host '    ok' -ForegroundColor Green
    continue
  }

  if ($status -eq '422') {
    throw @"
O GitHub recusou o asset $($arquivo.Name) com 422.

O nome do arquivo ja existe nesta release. GitHub nao deixa renomear nem
substituir asset: apague o antigo em
  https://github.com/$Repo/releases/edit/$tag
e rode de novo.
"@
  }

  if ($status -eq '404') {
    throw @"
HTTP 404 ao subir $($arquivo.Name).

A URL de upload foi $url

Confere se ela comeca com https://uploads.github.com — api.github.com nao
aceita POST de asset e devolve 404 sem corpo util.
"@
  }

  throw @"
Falha ao subir $($arquivo.Name): HTTP $status

Para ver o corpo do erro:
  curl.exe -X POST -H "Authorization: Bearer `$env:GITHUB_TOKEN" --data-binary "@$($arquivo.FullName)" $url
"@
}

Write-Host "`nPublicado: https://github.com/$Repo/releases/tag/$tag" -ForegroundColor Green
Write-Host "Feed para a config do app:"
Write-Host "  https://github.com/$Repo/releases/latest/download"