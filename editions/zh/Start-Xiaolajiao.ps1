param([ValidateRange(1024, 65535)][int]$Port = 8769)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$entry = "http://127.0.0.1:$Port"
$portInUse = $false
$probe = [System.Net.Sockets.TcpClient]::new()
try { $probe.Connect('127.0.0.1', $Port); $portInUse = $true } catch { } finally { $probe.Dispose() }
if ($portInUse) { throw "端口 $Port 已被占用，无法确认该服务属于此工作目录。请使用 -Port 指定其他端口；现有服务不会被停止。" }
$pythonPath = Join-Path $PSScriptRoot 'deepseek-harness-base/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '请先运行 .\Install.ps1 安装运行环境。' }
$databasePath = Join-Path $PSScriptRoot 'data/workspace/harness.db'
$runtimePath = Join-Path $PSScriptRoot 'data/workspace/runtime'
Write-Host "小辣椒 · 智能组织：$entry"
& $pythonPath -X utf8 (Join-Path $PSScriptRoot 'server.py') --port $Port --db $databasePath --runtime-root $runtimePath
if ($LASTEXITCODE -ne 0) { throw '服务未正常退出，请查看上方错误信息。' }
