; 幻屿 Windows 安装包脚本（Inno Setup 6）
#define MyAppName "幻屿"
#define MyAppVersion "1.3.1"
#define MyAppPublisher "幻屿 · Your private cinema"
#define MyAppExeName "幻屿.exe"
#ifndef AppSourceDir
  #define AppSourceDir "package"
#endif
#ifndef PackageOutputDir
  #define PackageOutputDir "output"
#endif

[Setup]
AppId={{8F4E7C2A-9B3D-4E6F-A1C5-D2B8E7F4A9C3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DirExistsWarning=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableWelcomePage=no
DisableDirPage=no
UsePreviousAppDir=yes
AlwaysShowDirOnReadyPage=yes
DisableProgramGroupPage=yes
OutputDir={#PackageOutputDir}
OutputBaseFilename=幻屿-1.3.1-安装程序
SetupIconFile=..\public\yingyu.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
WizardSizePercent=110

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#AppSourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallDelete]
; 卸载仅移除程序文件，data 目录（媒体库与密钥）由用户自行决定去留
Type: files; Name: "{app}\library.tmp"
