param([switch]$FetchUpstreamSource)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeRoot = Join-Path $PSScriptRoot 'deepseek-harness-base'
$pythonPath = Join-Path $runtimeRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    python -m venv (Join-Path $runtimeRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or newer is required to create the runtime environment.' }
}
& $pythonPath -m pip install --disable-pip-version-check --index-url https://pypi.org/simple -r (Join-Path $runtimeRoot 'requirements.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned official runtime dependencies.' }
if ($FetchUpstreamSource) {
    $vendorPath = Join-Path $runtimeRoot 'vendor/deepseek-harness'
    if (-not (Test-Path -LiteralPath $vendorPath)) {
        git clone --depth 1 --branch dsh-v0.2.2-rc.2 https://github.com/deepseek-ai/deepseek-harness.git $vendorPath
        if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the pinned upstream source.' }
    }
    $sourceCommit = git -C $vendorPath rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $sourceCommit -ne 'ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c') { throw 'Upstream source differs from the pinned version. Review it before proceeding.' }
}
Write-Host 'The local runtime is ready. Start the workspace with .\Start-Xiaolajiao.ps1.'
