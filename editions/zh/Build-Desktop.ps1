param([switch]$SkipDependencyInstall)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12 or newer with npm before building.' }
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22 || (v[0]===22 && v[1]<12))process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.12 or newer is required.' }
$buildEnv = Join-Path $PSScriptRoot 'build/.venv'
$buildPython = Join-Path $buildEnv 'Scripts/python.exe'
if (-not $SkipDependencyInstall) {
    if (-not (Test-Path -LiteralPath $buildPython)) {
        python -m venv $buildEnv
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or newer is required.' }
    }
    & $buildPython -m pip install --disable-pip-version-check --index-url https://pypi.org/simple -r deepseek-harness-base/requirements.lock.txt -r desktop/requirements-build.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned backend build dependencies.' }
    npm ci --ignore-scripts --registry=https://registry.npmjs.org --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked desktop build dependencies.' }
    & $buildPython desktop/install-electron.py
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the official Electron runtime.' }
}
if (-not (Test-Path -LiteralPath $buildPython)) { throw 'Build environment missing. Run without -SkipDependencyInstall first.' }
& $buildPython scripts/build_backend.py
if ($LASTEXITCODE -ne 0) { throw 'Backend packaging failed.' }
node node_modules/electron-builder/cli.js --win nsis --x64 --publish never --config.electronDist=node_modules/electron/dist
if ($LASTEXITCODE -ne 0) { throw 'Desktop installer packaging failed.' }
Write-Host 'Windows x64 installer is in dist/. Nothing has been uploaded or published.'

