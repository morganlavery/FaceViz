$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $RootDir "native\build"
$SourcePath = Join-Path $RootDir "native\SpoutFramePublisher.cpp"
$OutputPath = Join-Path $BuildDir "SpoutFramePublisher.exe"

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

function Import-VisualStudioCompilerEnvironment {
  if (Get-Command cl.exe -ErrorAction SilentlyContinue) {
    return
  }

  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    return
  }

  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $installPath) {
    return
  }

  $vsDevCmd = Join-Path $installPath "Common7\Tools\VsDevCmd.bat"
  if (-not (Test-Path $vsDevCmd)) {
    return
  }

  $environment = & cmd.exe /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
  foreach ($line in $environment) {
    $separator = $line.IndexOf("=")
    if ($separator -le 0) {
      continue
    }

    $name = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    Set-Item -Path "Env:$name" -Value $value
  }
}

Import-VisualStudioCompilerEnvironment
$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
if (-not $cl) {
  throw "cl.exe was not found. Install Visual Studio C++ build tools or run this from a Visual Studio Developer PowerShell."
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
