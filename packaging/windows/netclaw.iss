; Inno Setup script for NetClaw Agent on Windows
; Generates: dist/NetClaw-Agent-Setup-<version>.exe (generic) or
;            dist/NetClaw-Agent-Setup-<slug>-<version>.exe (per-tenant)
;
; Generic build:
;   ISCC.exe netclaw.iss
;
; Per-tenant build (build.ps1 passes these via /D flags):
;   ISCC.exe ^
;     /DTenantSlug=acme ^
;     /DTenantDisplayName="NetClaw Agent — Acme 软件" ^
;     /DAppId={{<deterministic-guid>} ^
;     /DOutputBaseFilename=NetClaw-Agent-Setup-acme-0.10.0 ^
;     /DInstallSubdir=Agent-acme ^
;     netclaw.iss
;
; Wraps the PyInstaller --onedir output at ../../dist/netclaw/.

#ifndef TenantDisplayName
  #define TenantDisplayName "NetClaw Agent"
#endif
#ifndef AppId
  ; Generic-build AppId — preserve verbatim for backwards compat with the
  ; v0.10.0 generic installer (changing this orphans existing installs).
  #define AppId "{{6F0B6F35-9D2E-4E0F-8A37-NETCLAWAGENT01}"
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "NetClaw-Agent-Setup-0.10.0"
#endif
#ifndef InstallSubdir
  #define InstallSubdir "Agent"
#endif

#define MyAppName        TenantDisplayName
#define MyAppVersion     "0.10.0"
#define MyAppPublisher   "NetClaw"
#define MyAppURL         "https://netclawsec.com"
#define MyAppExeName     "netclaw.exe"
#define MyAppId          AppId

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\NetClaw\{#InstallSubdir}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=no
LicenseFile=
OutputDir=..\..\dist
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
WizardImageStretch=yes
SetupIconFile=icon\netclaw.ico

[Languages]
Name: "chinese"; MessagesFile: "i18n\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "addtopath";    Description: "{cm:AddToPath}";          GroupDescription: "{cm:AdditionalTasks}"; Flags: checkedonce
Name: "desktopicon";  Description: "{cm:CreateDesktopIcon}";  GroupDescription: "{cm:AdditionalTasks}"; Flags: checkedonce
Name: "startmenu";    Description: "{cm:CreateStartMenu}";    GroupDescription: "{cm:AdditionalTasks}"; Flags: checkedonce

[Files]
Source: "..\..\dist\netclaw\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\netclaw-launcher.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Primary Start Menu entry — opens the WebUI in a native window.
Name: "{group}\{#MyAppName}";              Filename: "{app}\NetClaw Agent.exe";    WorkingDir: "{app}"; IconFilename: "{app}\NetClaw Agent.exe"; Tasks: startmenu; Comment: "{cm:LauncherComment}"
Name: "{group}\{cm:CmdShortcut}";          Filename: "{app}\netclaw-launcher.cmd"; WorkingDir: "{userdocs}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: startmenu; Comment: "{cm:CmdShortcutComment}"
Name: "{group}\{cm:LicenseStatus}";        Filename: "{cmd}";                      Parameters: "/k ""{app}\{#MyAppExeName}"" license status & pause"; WorkingDir: "{userdocs}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: startmenu
Name: "{group}\{cm:Doctor}";               Filename: "{cmd}";                      Parameters: "/k ""{app}\{#MyAppExeName}"" doctor & pause";          WorkingDir: "{userdocs}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: startmenu
Name: "{group}\{cm:UninstallEntry}";       Filename: "{uninstallexe}"; Tasks: startmenu

; Desktop shortcut also points at the WebUI launcher.
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\NetClaw Agent.exe"; WorkingDir: "{app}"; IconFilename: "{app}\NetClaw Agent.exe"; Tasks: desktopicon; Comment: "{cm:LauncherComment}"

[Registry]
; Add install dir to user PATH if task selected
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addtopath; Check: NeedsAddPath('{app}')
; Persist license server URL hint (override-able by user)
Root: HKCU; Subkey: "Software\NetClaw\Agent"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletekey

[Code]
function NeedsAddPath(Param: string): Boolean;
var
  OrigPath: string;
  ExpandedParam: string;
begin
  ExpandedParam := ExpandConstant(Param);
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Uppercase(ExpandedParam) + ';', ';' + Uppercase(OrigPath) + ';') = 0;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Msg: string;
begin
  if CurStep = ssPostInstall then
  begin
    if ActiveLanguage = 'chinese' then
      Msg := 'NetClaw Agent 安装完成。' + #13#10 + #13#10
           + '首次激活：' + #13#10
           + '  1. 让你的公司管理员发给你 NCLW-XXXXX-XXXXX-XXXXX-XXXXX 激活码' + #13#10
           + '  2. 双击桌面或开始菜单的 NetClaw Agent 快捷方式' + #13#10
           + '  3. 在窗口里运行：netclaw license activate <你的激活码>' + #13#10
    else
      Msg := 'NetClaw Agent installation complete.' + #13#10 + #13#10
           + 'To activate this machine:' + #13#10
           + '  1. Get an NCLW-XXXXX-XXXXX-XXXXX-XXXXX key from your tenant admin' + #13#10
           + '  2. Open NetClaw Agent from Start Menu or Desktop' + #13#10
           + '  3. Run:  netclaw license activate <YOUR_KEY>' + #13#10;
    // Skip the message when the install is silent (/VERYSILENT) — they don't want a popup.
  end;
end;

[CustomMessages]
chinese.AddToPath=添加到 PATH 环境变量（推荐 — 让 netclaw 命令全局可用）
chinese.CreateDesktopIcon=在桌面创建快捷方式（推荐 — 双击直接打开 WebUI）
chinese.CreateStartMenu=在开始菜单创建快捷方式（推荐）
chinese.AdditionalTasks=附加选项
chinese.LauncherComment=NetClaw Agent — 双击打开 WebUI
chinese.CmdShortcut=NetClaw 命令行
chinese.CmdShortcutComment=打开命令行窗口（用于 license activate / chat 等命令）
chinese.LicenseStatus=查看 License 状态
chinese.Doctor=诊断（netclaw doctor）
chinese.UninstallEntry=卸载 NetClaw Agent

english.AddToPath=Add NetClaw to PATH (recommended)
english.CreateDesktopIcon=Create a desktop shortcut (recommended — double-click to open WebUI)
english.CreateStartMenu=Create Start Menu shortcuts (recommended)
english.AdditionalTasks=Additional tasks
english.LauncherComment=NetClaw Agent — double-click to open WebUI
english.CmdShortcut=NetClaw Command Line
english.CmdShortcutComment=Open a CMD prompt for license activate / chat / etc.
english.LicenseStatus=License status
english.Doctor=Doctor (netclaw doctor)
english.UninstallEntry=Uninstall NetClaw Agent

[Run]
; Launch the GUI after install. Notes:
;   - dropped `shellexec` — ShellExecute silently fails on some Parallels/UAC
;     setups; default CreateProcess is more reliable for our own .exe
;   - added `WorkingDir: "{app}"` so the launcher resolves resources against
;     the install dir, not the installer's launch directory
;   - added `runasoriginaluser` so if the installer was elevated, the GUI
;     still launches as the logged-in user (WebView2 user-data dir lives
;     under HKCU/%LOCALAPPDATA%, mixing elevated + non-elevated breaks it)
Filename: "{app}\NetClaw Agent.exe"; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: postinstall nowait skipifsilent runasoriginaluser
