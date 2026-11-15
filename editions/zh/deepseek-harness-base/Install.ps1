param([switch]$FetchUpstreamSource)
$ErrorActionPreference = 'Stop'
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'Install.ps1') -FetchUpstreamSource:$FetchUpstreamSource
