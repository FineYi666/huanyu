@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0launch.mjs"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo 请安装 Node.js 22 或更新版本，或使用 release 目录中的免安装便携版。
    pause
    exit /b 1
  )
  node "%~dp0launch.mjs"
)
if errorlevel 1 pause
