$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $RootDir "native\build"
$SourcePath = Join-Path $RootDir "native\SpoutFramePublisher.cpp"
$OutputPath = Join-Path $BuildDir "SpoutFramePublisher.exe"

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
if (-not $cl) {
  throw "cl.exe was not found. Run this from a Visual Studio Developer PowerShell or Developer Command Prompt."
}

& $cl.Path /nologo /std:c++17 /EHsc /O2 /MT /W3 /Fe:$OutputPath $SourcePath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to build SpoutFramePublisher.exe"
}

$dllCandidates = @()
if ($env:SPOUT_LIBRARY_DLL) {
  $dllCandidates += $env:SPOUT_LIBRARY_DLL
}
$dllCandidates += Join-Path $RootDir "native\vendor\Spout2\SpoutLibrary.dll"
$dllCandidates += Join-Path $RootDir "native\vendor\Spout2\Binaries\x64\SpoutLibrary.dll"
$dllCandidates += Join-Path $RootDir "native\vendor\Spout2\SPOUTSDK\SpoutLibrary\x64\SpoutLibrary.dll"
$dllCandidates += Join-Path $RootDir "native\vendor\Spout2\BUILD\Binaries\x64\SpoutLibrary.dll"

$spoutLibrary = $dllCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $spoutLibrary) {
  throw "SpoutLibrary.dll was not found. Set SPOUT_LIBRARY_DLL or copy it to native\vendor\Spout2\SpoutLibrary.dll."
}

Copy-Item -Force $spoutLibrary (Join-Path $BuildDir "SpoutLibrary.dll")
Write-Host "Built $OutputPath"
Write-Host "Copied $spoutLibrary to native\build\SpoutLibrary.dll"
