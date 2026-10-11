param(
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ExecutableName,
  [Parameter(Mandatory = $true)][string]$UninstallerName,
  [Parameter(Mandatory = $true)][int]$InstallerProcessId
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\') + '\'
$installerPath = (Get-Process -Id $InstallerProcessId).Path

function Get-BlockingProcesses {
  # Do not use StartsWith without a separator: C:\App must not match C:\AppOther.
  $processes = @(Get-CimInstance Win32_Process)
  $blocked = @{}
  foreach ($process in $processes) {
    if ($process.ProcessId -eq $PID -or $process.ProcessId -eq $InstallerProcessId) { continue }
    $exe = $process.ExecutablePath
    if ($exe -and $exe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      if ([IO.Path]::GetFileName($exe) -eq $UninstallerName) { continue }
      $blocked[$process.ProcessId] = $process
    } elseif (!$exe -and $process.Name -eq $ExecutableName) {
      throw "Cannot inspect $ExecutableName (PID $($process.ProcessId)); run the installer as administrator."
    }
  }
  return @($blocked.Values)
}

try {
  # Give Electron time to quit normally before terminating remaining bundled services.
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $blocked = @(Get-BlockingProcesses)
    if (!$blocked.Count) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  for ($attempt = 0; $attempt -lt 5 -and $blocked.Count; $attempt++) {
    foreach ($process in $blocked) {
      # Never kill the whole tree: the installer can be a child of the old app.
      # Recheck below also handles processes that exit or deny termination.
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 1000
    $blocked = @(Get-BlockingProcesses)
  }
  if ($blocked.Count) {
    throw "Processes still running: $(($blocked | ForEach-Object { "$($_.Name) ($($_.ProcessId))" }) -join ', ')"
  }

  # The old uninstaller checks processes, but other software can still lock app files.
  # Probe before it starts moving/removing files so failures leave the old app intact.
  if (Test-Path -LiteralPath $root) {
    Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
      if ($_.Name -eq $UninstallerName -or $_.FullName -eq $installerPath) { return }
      $handle = $null
      try {
        $handle = [IO.File]::Open($_.FullName, 'Open', 'Read', 'None')
      } finally {
        if ($handle) { $handle.Dispose() }
      }
    }
  }
  exit 0
} catch {
  Write-Output $_.Exception.Message
  exit 1
}
