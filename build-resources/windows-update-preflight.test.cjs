const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const nsis = fs.readFileSync(path.join(__dirname, 'installer.nsh'), 'utf8')
const ps = fs.readFileSync(path.join(__dirname, 'windows-update-preflight.ps1'), 'utf8')
const templates = path.join(__dirname, '../node_modules/.pnpm')
// pnpm applies patchedDependencies into a *_patch_hash=* directory; require it
// so the contract below fails loudly when the patch stops being applied.
const builder = fs.readdirSync(templates).find(n => n.startsWith('app-builder-lib@') && n.includes('_patch_hash='))
if (!builder) throw new Error('app-builder-lib patch is not applied (no _patch_hash directory)')
const readTemplate = name => fs.readFileSync(path.join(templates, builder, 'node_modules/app-builder-lib/templates/nsis', name), 'utf8')

test('preflight matches installed builder registry resolution and uninstall scopes', () => {
  const util = readTemplate('include/installUtil.nsh')
  assert.match(util, /UNINSTALL_REGISTRY_KEY_2/)
  assert.match(util, /readReg \$installationDir.*INSTALL_REGISTRY_KEY.*InstallLocation/)
  assert.match(nsis, /ReadRegStr \$3 \$\{ROOT\}.*UNINSTALL_REGISTRY_KEY.*UninstallString/)
  assert.match(nsis, /UNINSTALL_REGISTRY_KEY_2/)
  assert.match(nsis, /ReadRegStr \$4 \$\{ROOT\}.*INSTALL_REGISTRY_KEY.*InstallLocation/)
  assert.match(nsis, /Call GetInQuotes[\s\S]*Call GetFileParent/)
  assert.match(nsis, /PreflightOldInstallation SHELL_CONTEXT[\s\S]*\$installMode == "all"[\s\S]*PreflightOldInstallation HKCU/)
  assert.match(nsis, /-InstallDirectory "\$4"/)
  assert.doesNotMatch(nsis, /-InstallDirectory "\$INSTDIR"/)
  const section = readTemplate('installSection.nsh')
  assert.ok(section.indexOf('CHECK_APP_RUNNING') < section.indexOf('!insertmacro uninstallOldVersion SHELL_CONTEXT'))
  assert.match(section, /\$installMode == "all"[\s\S]*uninstallOldVersion HKEY_CURRENT_USER/)
})
test('elevated inner hook establishes machine scope before preflight', () => {
  const init = nsis.slice(nsis.indexOf('!macro customInit'), nsis.indexOf('!macro customInstall\n'))
  assert.match(init, /UAC_IsInnerInstance[\s\S]*setInstallModePerAllUsers[\s\S]*customCheckAppRunning/)
  assert.match(readTemplate('installSection.nsh'), /ifNot.*UAC_IsInnerInstance[\s\S]*CHECK_APP_RUNNING/)
  const installer = readTemplate('installer.nsi')
  assert.ok(installer.indexOf('!insertmacro initMultiUser') < installer.indexOf('!insertmacro customInit'))
})
test('termination is handle-bound, identity checked, scoped and never tree-wide', () => {
  assert.match(ps, /\$null = \$live.Handle[\s\S]*\$live.StartTime[\s\S]*\$process.ExecutablePath[\s\S]*\$live.Kill\(\)/)
  assert.match(ps, /\$root = \$fullRoot \+ '\\'/)
  assert.match(ps, /\$live.Id -eq \$InstallerProcessId/)
  assert.doesNotMatch(ps, /Stop-Process|taskkill|\.Kill\(\$true\)/i)
  assert.doesNotMatch(ps, /GetFileName\(\$exe\).*UninstallerName/)
})
test('persistent diagnostics and exclusive probes fail closed', () => {
  assert.match(nsis, /-LogPath "\$TEMP\\vectcut-update-preflight-\$0.log"/)
  assert.match(ps, /Add-Content -LiteralPath \$LogPath/)
  assert.match(ps, /Exclusive probe failed/)
  assert.match(ps, /ReparsePoint/)
  assert.match(ps, /\[IO.File\]::Open\(\$item.FullName, 'Open', 'Read', 'None'\)/)
  assert.match(ps, /Get-BlockingProcesses\)\.Count/)
  assert.match(ps, /exit 1/)
  assert.doesNotMatch(nsis, /!macro customUnInstallCheck/)
})

test('original Windows app handoff is independently checked with PID, path and creation identity', () => {
  assert.match(ps, /\$env:VECTCUT_UPDATE_APP_PID/)
  assert.match(ps, /\$env:VECTCUT_UPDATE_APP_PATH/)
  assert.match(ps, /\$env:VECTCUT_UPDATE_APP_CREATED/)
  assert.match(ps, /Get-Process -Id \$expectedPid/)
  assert.match(ps, /\$created - \$expectedCreated/)
  assert.match(ps, /\$expectedPath.StartsWith\(\$root/)
  assert.match(ps, /\$exe = \$inspected.Path/)
  assert.match(ps, /already exited; no main-process kill needed/)
  assert.doesNotMatch(nsis, /SetEnv|SetEnvironmentVariable|SetOutPath.*TEMP/i)
})

test('standalone uninstaller keeps standard builder check', () => {
  assert.match(nsis, /!ifndef BUILD_UNINSTALLER\s+!macro customCheckAppRunning[\s\S]*!endif ; BUILD_UNINSTALLER/)
})

test('file copy uses per-file robocopy and update uninstall keeps install root', () => {
  const extract = readTemplate('include/extractAppPackage.nsh')
  // Shell CopyFiles must no longer be the primary copy path.
  assert.match(extract, /nsExec::ExecToLog `"\$SYSDIR\\Robocopy.exe" "\$PLUGINSDIR\\7z-out" "\$OUTDIR" \/E \/COPY:DAT \/DCOPY:DAT \/R:1 \/W:1 \/NFL \/NDL \/NP \/NJH`/)
  // Exit codes 0-7 are success (1 = files copied); >= 8 falls into the retry loop.
  assert.match(extract, /\$\{elseif\} \$R0 < 8\s+Goto DoneExtract7za/)
  // Degrade to stock behavior when robocopy itself cannot be launched.
  assert.match(extract, /robocopy unavailable, falling back to CopyFiles[\s\S]*CopyFiles \/SILENT "\$PLUGINSDIR\\7z-out\\\*" \$OUTDIR/)
  // Original retry loop and user-facing failure handling stay intact.
  assert.match(extract, /LoopExtract7za:[\s\S]*MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "\$\(appCannotBeClosed\)"[\s\S]*RetryExtract7za:/)

  const uninstaller = readTemplate('uninstaller.nsh')
  // Updates purge the contents via robocopy /MIR but must keep the install root.
  assert.match(uninstaller, /\$\{if\} \$\{isUpdated\}[\s\S]*empty-for-purge[\s\S]*\/MIR \/R:1 \/W:1/)
  // Robocopy unavailable/failed degrades to stock full removal.
  assert.match(uninstaller, /\$\{orif\} \$R0 >= 8[\s\S]*?RMDir \/r \$INSTDIR/)
  // Regular uninstall still removes the whole installation directory.
  assert.match(uninstaller, /\$\{else\}\s+# Remove all files[\s\S]*RMDir \/r \$INSTDIR/)
  // The stock root removal must not run unconditionally anymore.
  assert.doesNotMatch(uninstaller, /SetOutPath \$TEMP\s+RMDir \/r \$INSTDIR/)
})
