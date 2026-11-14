@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo EBCrypto CLI requires Node.js on PATH. 1>&2
  exit /b 2
)
node "%~dp0..\mcp\cli.mjs" %*
exit /b %errorlevel%
