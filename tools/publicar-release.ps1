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

Write-Host "`nSubindo artefatos..." -ForegroundColor Cyan
$upload = "$api/$($release.id)/assets?name={0}"

foreach ($arquivo in @(
    Get-ChildItem -Path (Join-Path $saida 'latest.yml') -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $saida '*.blockmap') -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $saida "*-$Version-setup.exe") -ErrorAction SilentlyContinue
  )) {
  $destino = $upload -f [uri]::EscapeDataString($arquivo.Name)
  $bytes = [System.IO.File]::ReadAllBytes($arquivo.FullName)

  $tam = if ($arquivo.Length -lt 1MB) { '{0:N0} KB' -f ($arquivo.Length / 1KB) } else { '{0:N1} MB' -f ($arquivo.Length / 1MB) }
  Write-Host "  $($arquivo.Name)  $tam"
  Invoke-RestMethod -Uri $destino -Headers $headers -Method Post `
    -ContentType 'application/octet-stream' -Body $bytes | Out-Null
}

Write-Host "`nPublicado: https://github.com/$Repo/releases/tag/$tag" -ForegroundColor Green
Write-Host "Feed para a config do app:"
Write-Host "  https://github.com/$Repo/releases/latest/download"