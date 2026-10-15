# Compila os addons nativos do Arc GX.
#
#   .\tools\build-native.ps1              # wgc-capture
#   .\tools\build-native.ps1 -Vision      # cell-vision
#   .\tools\build-native.ps1 -All         # ambos
#
# Carrega o vcvars64 antes: sem o Visual Studio Build Tools no PATH, o cargo
# compila e quebra na etapa de link com "link.exe not found".

param(
  [switch]$Vision,
  [switch]$All,
  [switch]$Debug
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\msvc-env.ps1"

$root = Split-Path -Parent $PSScriptRoot
# Cada flag precisa ser um elemento do array: "--platform --release" como string
# unica vira um argumento so (com espaco dentro) e o cargo rejeita.
$buildArgs = @('--platform')
if (-not $Debug) { $buildArgs += '--release' }

$targets = @()
if ($All -or -not $Vision) { $targets += @{ Name = 'wgc-capture'; Dir = 'packages\native\wgc-capture' } }
if ($All -or $Vision) { $targets += @{ Name = 'cell-vision'; Dir = 'packages\native\cell-vision' } }

$failed = @()

foreach ($t in $targets) {
  $dir = Join-Path $root $t.Dir
  if (-not (Test-Path -LiteralPath $dir)) { continue }

  $mode = ''
  if ($Debug) { $mode = ' (debug)' }
  Write-Host ''
  Write-Host ("=> compilando " + $t.Name + $mode) -ForegroundColor Cyan

  Push-Location $dir
  # O napi/cargo escrevem aviso em stderr; com ErrorActionPreference=Stop isso
  # vira excecao e mata o build mesmo com codigo 0.
  $ErrorActionPreference = 'Continue'
  try {
    & npx napi build @buildArgs
    if ($LASTEXITCODE -ne 0) { $failed += $t.Name }
  } catch {
    Write-Host ("   falhou: " + $_.Exception.Message) -ForegroundColor Red
    $failed += $t.Name
  } finally {
    Pop-Location
    $ErrorActionPreference = 'Stop'
  }
}

Write-Host ''
if ($failed.Count) {
  Write-Host ('FALHOU: ' + ($failed -join ', ')) -ForegroundColor Red
  exit 1
}
Write-Host 'addons nativos ok' -ForegroundColor Green