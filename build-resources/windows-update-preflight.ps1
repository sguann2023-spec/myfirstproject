param(
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ExecutableName,
  [Parameter(Mandatory = $true)][string]$UninstallerName,
  [Parameter(Mandatory = $true)][int]$InstallerProcessId,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = 'Stop'
function Write-PreflightLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "$([DateTime]::UtcNow.ToString('o')) $Message"
}

function Get-BlockingProcesses {
  $blocked = @()
  foreach ($process in @(Get-CimInstance Win32_Process)) {
    if ($process.ProcessId -eq $PID -or $process.ProcessId -eq $InstallerProcessId) { continue }
    $exe = $process.ExecutablePath
    # Separator boundary prevents C:\App matching C:\AppOther.
    if ($exe -and $exe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      if ([string]::Equals($exe, $installerPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $blocked += $process
    } elseif (!$exe -and $process.Name -eq $ExecutableName) {
      throw "Cannot inspect $ExecutableName (PID $($process.ProcessId)); run the installer as administrator."
    }
  }
  return $blocked
}

try {
  Write-PreflightLog "BEGIN installer=$InstallerProcessId directory=$InstallDirectory"
  if (![IO.Path]::IsPathRooted($InstallDirectory)) { throw 'Installation directory must be absolute.' }
  $fullRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
  if ($fullRoot -eq [IO.Path]::GetPathRoot($fullRoot).TrimEnd('\')) { throw 'Refusing a volume root as installation directory.' }
  $root = $fullRoot + '\'
  $installerPath = (Get-Process -Id $InstallerProcessId -ErrorAction Stop).Path
  if (!$installerPath) { throw 'Cannot identify installer executable.' }
  Write-PreflightLog "Resolved root=$root installer=$installerPath"

  # Give Electron time to quit normally before terminating bundled services.
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $blocked = @(Get-BlockingProcesses)
    if (!$blocked.Count) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  for ($attempt = 0; $attempt -lt 5 -and $blocked.Count; $attempt++) {
    foreach ($process in $blocked) {
      # Bind to an opened process handle BEFORE inspecting identity. Kill via
      # that same handle, never a newly resolved PID and never the process tree.
      $live = $null
      try {
        $live = Get-Process -Id $process.ProcessId -ErrorAction Stop
        $null = $live.Handle
        if ($live.HasExited) { continue }
        $path = $live.MainModule.FileName
        $created = ([DateTime]$process.CreationDate).ToUniversalTime()
        # CIM timestamps have microsecond precision; StartTime has 100ns ticks.
        if ([Math]::Abs($live.StartTime.ToUniversalTime().Ticks - $created.Ticks) -ge 10 -or
            ![string]::Equals($path, $process.ExecutablePath, [StringComparison]::OrdinalIgnoreCase)) {
          Write-PreflightLog "Identity changed; skip PID=$($process.ProcessId)"
          continue
        }
        if (!$path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or
            $live.Id -eq $PID -or $live.Id -eq $InstallerProcessId -or
            [string]::Equals($path, $installerPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
        Write-PreflightLog "Terminate PID=$($live.Id) exe=$path created=$created"
        $live.Kill()
      } catch {
        Write-PreflightLog "Terminate/recheck PID=$($process.ProcessId): $($_.Exception.Message)"
      } finally {
        if ($live) { $live.Dispose() }
      }
    }
    Start-Sleep -Milliseconds 1000
    $blocked = @(Get-BlockingProcesses)
  }
  if ($blocked.Count) {
    throw "Processes still running: $(($blocked | ForEach-Object { "$($_.Name) ($($_.ProcessId))" }) -join ', ')"
  }

  # Probe every file before old uninstall starts. Do not follow junctions or
  # symlinks outside the installation boundary.
  function Test-DirectoryFiles([string]$Directory) {
    foreach ($item in Get-ChildItem -LiteralPath $Directory -Force -ErrorAction Stop) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Cannot safely probe reparse point: $($item.FullName)"
      }
      if ($item.PSIsContainer) { Test-DirectoryFiles $item.FullName; continue }
      if ([string]::Equals($item.FullName, $installerPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $handle = $null
      try {
        $handle = [IO.File]::Open($item.FullName, 'Open', 'Read', 'None')
      } catch {
        throw "Exclusive probe failed: $($item.FullName): $($_.Exception.Message)"
      } finally {
        if ($handle) { $handle.Dispose() }
      }
    }
  }
  if (Test-Path -LiteralPath $root) {
    if ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Cannot safely probe reparse root: $root"
    }
    Test-DirectoryFiles $root
  }
  # A process may have restarted during the file scan.
  if (@(Get-BlockingProcesses).Count) { throw 'Installation processes restarted during file probes.' }
  Write-PreflightLog 'SUCCESS'
  exit 0
} catch {
  $message = $_.Exception.Message
  try { Write-PreflightLog "FAILURE $message" } catch { }
  Write-Output "$message Log: $LogPath"
  exit 1
}
