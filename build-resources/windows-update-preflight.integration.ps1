# Run on Windows with Windows PowerShell 5.1. Uses only disposable temp files
# and test executables; never points preflight at the real installed app.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'windows-update-preflight.ps1'
$workspace = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
$root = Join-Path $workspace 'App'
$sibling = Join-Path $workspace 'AppOther'
$children = @()
try {
  $null = New-Item -ItemType Directory -Path $root, $sibling
  $source = 'public class PreflightSleeper { public static void Main() { System.Threading.Thread.Sleep(600000); } }'
  $exe = Join-Path $root 'helper.exe'
  Add-Type -TypeDefinition $source -OutputAssembly $exe -OutputType ConsoleApplication
  Copy-Item $exe (Join-Path $sibling 'helper.exe')
  $owned = Start-Process $exe -PassThru
  $outside = Start-Process (Join-Path $sibling 'helper.exe') -PassThru
  $children = @($owned, $outside)
  function Invoke-TestPreflight([int]$Expected) {
    & "$PSHOME\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -InstallDirectory $root -ExecutableName helper.exe -UninstallerName uninstall.exe -InstallerProcessId $PID -LogPath (Join-Path $workspace 'preflight.log')
    if ($LASTEXITCODE -ne $Expected) { throw "Expected $Expected, got $LASTEXITCODE" }
  }
  Invoke-TestPreflight 0
  if (!$owned.WaitForExit(3000)) { throw 'Owned helper survived' }
  if ($outside.HasExited) { throw 'Sibling path helper was killed' }
  $locked = Join-Path $root 'locked.dat'
  [IO.File]::WriteAllText($locked, 'test')
  $handle = [IO.File]::Open($locked, 'Open', 'ReadWrite', 'None')
  try { Invoke-TestPreflight 1 } finally { $handle.Dispose() }
  Invoke-TestPreflight 0
  $log = Get-Content -Raw (Join-Path $workspace 'preflight.log')
  if ($log -notmatch 'Terminate PID=' -or $log -notmatch 'Exclusive probe failed' -or $log -notmatch 'SUCCESS') { throw 'Missing diagnostic records' }
  Write-Output 'PASS: owned helper termination, sibling exclusion, locked-file refusal, retry and diagnostics'
} finally {
  foreach ($child in $children) {
    if (!$child.HasExited) { $child.Kill(); $child.WaitForExit() }
    $child.Dispose()
  }
  Remove-Item -LiteralPath $workspace -Recurse -Force
}
