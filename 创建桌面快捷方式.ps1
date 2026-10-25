$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$appName = [string][char]0x5E7B + [char]0x5C7F
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath ($appName + '.lnk')
$scriptName = [string][char]0x542F + [char]0x52A8 + $appName + '.vbs'
$launcher = Join-Path $appRoot $scriptName
$nativePath = Join-Path $appRoot ($appName + '.exe')
if (!(Test-Path -LiteralPath $nativePath)) { $nativePath = Join-Path $appRoot ('release\' + $appName + '-1.3.0-Windows-x64\' + $appName + '.exe') }
$iconPath = Join-Path $appRoot 'dist\yingyu.ico'
if (!(Test-Path -LiteralPath $launcher) -or !(Test-Path -LiteralPath $iconPath)) { throw 'Missing launcher or icon. Build the app first.' }
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shell.CreateShortcut($shortcutPath)
    if ($existing.Arguments -ne ('"' + $launcher + '"')) {
        $backupPath = Join-Path $desktopPath ($appName + '-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.lnk')
        Copy-Item -LiteralPath $shortcutPath -Destination $backupPath
    }
}
$shortcut = $shell.CreateShortcut($shortcutPath)
if (!(Test-Path -LiteralPath $nativePath)) { throw 'Missing native desktop executable. Use the full Windows desktop package.' }
$shortcut.TargetPath = $nativePath
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = Split-Path -Parent $nativePath
$shortcut.IconLocation = $iconPath + ',0'
$shortcut.Description = $appName + ' - Your private cinema'
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Output $shortcutPath
