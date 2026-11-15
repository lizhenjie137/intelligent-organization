param([ValidateRange(1024, 65535)][int]$Port = 8771)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$entry = "http://127.0.0.1:$Port"
$portInUse = $false
$probe = [System.Net.Sockets.TcpClient]::new()
try { $probe.Connect('127.0.0.1', $Port); $portInUse = $true } catch { } finally { $probe.Dispose() }
if ($portInUse) { throw "Port $Port is already in use; its workspace cannot be confirmed. Choose another port with -Port. The existing service has not been stopped." }
$pythonPath = Join-Path $PSScriptRoot 'deepseek-harness-base/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run .\Install.ps1 first to install the local runtime.' }
$databasePath = Join-Path $PSScriptRoot 'data/workspace/harness.db'
$runtimePath = Join-Path $PSScriptRoot 'data/workspace/runtime'
Write-Host "Xiaolajiao · Intelligent Organization: $entry"
& $pythonPath -X utf8 (Join-Path $PSScriptRoot 'server.py') --port $Port --db $databasePath --runtime-root $runtimePath
if ($LASTEXITCODE -ne 0) { throw 'The service stopped with an error. See the output above.' }
