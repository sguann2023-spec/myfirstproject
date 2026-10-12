!include LogicLib.nsh
!define WINDOWS_UPDATE_PREFLIGHT_SCRIPT "${PROJECT_DIR}\build-resources\windows-update-preflight.ps1"
!echo "Windows update preflight source: ${WINDOWS_UPDATE_PREFLIGHT_SCRIPT}"

!macro customCheckAppRunning
  Push $0
  Push $1
  Push $2
  InitPluginsDir
  File "/oname=$PLUGINSDIR\windows-update-preflight.ps1" "${WINDOWS_UPDATE_PREFLIGHT_SCRIPT}"
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  ${Do}
    nsExec::ExecToStack /TIMEOUT=120000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-update-preflight.ps1" -InstallDirectory "$INSTDIR" -ExecutableName "${APP_EXECUTABLE_FILENAME}" -UninstallerName "${UNINSTALL_FILENAME}" -InstallerProcessId $0`
    Pop $2
    Pop $1
    ${If} $2 == 0
      ${ExitDo}
    ${EndIf}
    DetailPrint "Update preflight failed ($2): $1"
    MessageBox MB_RETRYCANCEL|MB_ICONSTOP "更新前检查失败，尚未开始卸载。请关闭流光剪辑及相关后台任务，必要时以管理员身份运行安装包。$\r$\n$\r$\n$1" /SD IDCANCEL IDRETRY +2
    Quit
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customInit
  ; Assisted installers skip CHECK_APP_RUNNING in the elevated inner instance.
  ${If} ${UAC_IsInnerInstance}
    !insertmacro customCheckAppRunning
  ${EndIf}
!macroend

!macro customInstall
  SetRegView 64
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"

  ${If} $0 == 1
    DetailPrint "Microsoft Visual C++ 2015-2022 Redistributable (x64) already installed."
    Goto VCRedistDone
  ${EndIf}

  IfFileExists "$INSTDIR\resources\redist\vc_redist.x64.exe" 0 VCRedistMissing

  DetailPrint "Installing Microsoft Visual C++ 2015-2022 Redistributable (x64)..."
  ExecWait '"$INSTDIR\resources\redist\vc_redist.x64.exe" /install /quiet /norestart' $1

  ${If} $1 == 0
  ${OrIf} $1 == 1638
  ${OrIf} $1 == 3010
    DetailPrint "Visual C++ Redistributable install completed with code $1."
    Goto VCRedistDone
  ${EndIf}

  MessageBox MB_ICONSTOP|MB_OK "Microsoft Visual C++ 2015-2022 Redistributable (x64) 安装失败，错误代码: $1。请以管理员身份重新运行安装包，或手动安装后再试。"
  Abort

VCRedistMissing:
  MessageBox MB_ICONSTOP|MB_OK "未找到随安装包附带的 Microsoft Visual C++ 2015-2022 Redistributable (x64) 安装程序。请重新下载安装包后再试。"
  Abort

VCRedistDone:
!macroend
