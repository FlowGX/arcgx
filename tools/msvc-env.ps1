# Loads the MSVC build environment (vcvars64.bat) into the current session.
#
# Rust compiles fine, but the linker (link.exe) and the Windows SDK libs only
# exist after vcvars runs. Without this, cargo fails at the link step with
# "linker `link.exe` not found".
#
# Usage:  . .\tools\msvc-env.ps1

$bt = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools'
$vcvars = Join-Path $bt 'VC\Auxiliary\Build\vcvars64.bat'

if (-not (Test-Path -LiteralPath $vcvars)) {
    throw "vcvars64.bat not found at $vcvars -- install Build Tools with the C++ workload."
}

$dump = cmd /s /c ('call "{0}" >nul 2>&1 & set' -f $vcvars)

foreach ($line in $dump) {
    if ($line -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

$env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Process')