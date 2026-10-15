# Verifica se o PAT tem escrita no repositorio, antes de subir 108 MB.
#
# ## ## ## Por que isto existe
#
# `GET /releases` funciona com qualquer token, porque o repositorio e publico
# e leitura nao exige permissao. Entao o script acha a release, imprime
# "Release ja existe", e só THEN o `POST /assets` devolve 404 — depois de
# dois minutos de build e empacotamento.
#
# A ordem correta e checar escrita primeiro, com um arquivo de 1 byte.

[CmdletBinding()]
param(
  # Opcional. Padrao: sai do remote `origin`.
  [string]$Repo
)

$ErrorActionPreference = 'Stop'

[Net.ServicePointManager]::SecurityProtocol =
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if (-not $Repo) {
  $remote = git remote get-url origin 2>$null
  if ($remote -match 'github\.com[:/](?<o>[^/]+)/(?<r>[^/]+?)(?:\.git)?$') {
    $Repo = "$($Matches.o)/$($Matches.r)"
  }
  else { throw 'Informe -Repo owner/nome' }
}

$token = $env:GITHUB_TOKEN
if (-not $token) { throw 'Defina GITHUB_TOKEN antes.' }

$headers = @{
  Authorization           = "Bearer $token"
  Accept                  = 'application/vnd.github+json'
  'X-GitHub-Api-Version'  = '2022-11-28'
  'User-Agent'            = 'arcgx-check'
}

Write-Host "Repositorio: $Repo`n"

# 1) o token e valido?
try {
  $u = Invoke-RestMethod 'https://api.github.com/user' -Headers $headers
  Write-Host "  [ok] token autentica como '$($u.login)'" -ForegroundColor Green
}
catch {
  $s = [int]$_.Exception.Response.StatusCode
  if ($s -eq 401) { throw "Token invalido ou expirado (401). Regenere em https://github.com/settings/personal-access-tokens" }
  throw "Falha ao falar com a API (HTTP $s)."
}

# 2) o repositorio aparece para o token?
try {
  $r = Invoke-RestMethod "https://api.github.com/repos/$Repo" -Headers $headers
  Write-Host "  [ok] repositorio visivel (visibility=$($r.visibility))" -ForegroundColor Green
}
catch {
  $s = [int]$_.Exception.Response.StatusCode
  if ($s -eq 404) { throw "Token nao alcanca $Repo (404). Em 'Repository access', marque o repositorio explicitamente." }
  throw "Falha ao ler o repositorio (HTTP $s)."
}

# 3) o token tem escrita? Teste de verdade: cria e apaga um asset na release mais recente.
#
# ## ## ## curl.exe, e nao Invoke-RestMethod
#
# O PS 5.1 manda `[byte[]]` com `Transfer-Encoding: chunked`, e o upload do
# GitHub responde 404 nesse caso. O token pode estar perfeito e o teste
# reprovar do mesmo jeito — foi exatamente o que aconteceu: `permissions.admin`
# era True e o probe dava 404.
$releases = @(Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Headers $headers)
if ($releases.Count -eq 0) {
  Write-Host "  [--] nenhuma release ainda; nada para testar" -ForegroundColor Yellow
  Write-Host "  Rode .\tools\publicar-release.ps1 -DryRun e depois de novo sem -DryRun."
  exit 0
}

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
  throw 'curl.exe nao encontrado; instale o curl ou suba os arquivos pelo site do GitHub.'
}

$alvo = $releases[0]
Write-Host "  [--] testando escrita na release $($alvo.tag_name)..."

$tmp = Join-Path $env:TEMP 'arcgx-perm-probe.txt'
Set-Content -LiteralPath $tmp -Value 'probe' -Encoding ascii -NoNewline

$nome = "perm-probe-$([guid]::NewGuid().ToString('N').Substring(0,8)).txt"
$assetId = $null
$status = $null

try {
  $status = (& curl.exe -sS -w '%{http_code}' -o "$tmp.resposta.json" `
      -X POST `
      -H "Authorization: Bearer $token" `
      -H "Accept: application/vnd.github+json" `
      -H "X-GitHub-Api-Version: 2022-11-28" `
      -H "Content-Type: application/octet-stream" `
      --data-binary "@$tmp" `
      "https://api.github.com/repos/$Repo/releases/$($alvo.id)/assets?name=$nome" 2>&1 | Select-Object -Last 1)

  if ($status -eq '201') {
    # O corpo da resposta tem o id do asset, para poder apagar o probe.
    try { $assetId = (Get-Content "$tmp.resposta.json" -Raw | ConvertFrom-Json).id } catch { }
    Write-Host "  [ok] TEM permissao de escrita" -ForegroundColor Green
  }
  else {
    Write-Host "  [XX] upload recusado (HTTP $status)" -ForegroundColor Red
    if (Test-Path "$tmp.resposta.json") {
      Write-Host "  corpo: $((Get-Content "$tmp.resposta.json" -Raw).Trim())" -ForegroundColor DarkGray
    }
    Write-Host @"

Se 403/404, confira em https://github.com/settings/personal-access-tokens:
  Repository access ... Only select repositories > $Repo
  Contents ........... Read and write
"@
    exit 1
  }
}
finally {
  # ## ## ## Apaga o probe, sempre
  #
  # Sem isto cada checagem deixa lixo na release. E um asset com nome
  # 'perm-probe' publicado e o que o electron-updater enxergaria primeiro se
  # ele varresse a release em vez do latest.yml.
  if ($assetId) {
    try {
      & curl.exe -sS -o NUL -X DELETE `
        -H "Authorization: Bearer $token" `
        -H "Accept: application/vnd.github+json" `
        -H "X-GitHub-Api-Version: 2022-11-28" `
        "https://api.github.com/repos/$Repo/releases/assets/$assetId"
      Write-Host '  [--] probe removido'
    }
    catch { Write-Host "  [!!] nao consegui remover o probe" -ForegroundColor Yellow }
  }
  Remove-Item -LiteralPath $tmp, "$tmp.resposta.json" -Force -ErrorAction SilentlyContinue
}

Write-Host "`nTudo certo. Pode rodar .\tools\publicar-release.ps1" -ForegroundColor Green