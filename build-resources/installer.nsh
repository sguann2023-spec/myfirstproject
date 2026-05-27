!include LogicLib.nsh

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
