@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0stop.mjs"
) else (
  node "%~dp0stop.mjs"
)
if errorlevel 1 pause
