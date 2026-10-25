; 幻屿 Windows 安装包脚本（Inno Setup 6）
#define MyAppName "幻屿"
#define MyAppVersion "1.3.0"
#define MyAppPublisher "幻屿 · Your private cinema"
#define MyAppExeName "幻屿.exe"

[Setup]
AppId={{8F4E7C2A-9B3D-4E6F-A1C5-D2B8E7F4A9C3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DirExistsWarning=no
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=E:\code\react\幻屿安装包
OutputBaseFilename=幻屿-1.3.0-安装程序
SetupIconFile=E:\code\react\me\yingyu\public\yingyu.ico
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
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "E:\code\react\me\yingyu\installer\staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: quicklaunchicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 卸载仅移除程序文件，data 目录（媒体库与密钥）由用户自行决定去留
Type: files; Name: "{app}\library.tmp"
