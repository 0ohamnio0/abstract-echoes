@echo off
chcp 65001 > nul
title Bremen Backyard Exhibition Launcher

cd /d "%~dp0"

if not exist node_modules (
  echo [1/4] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Check Node.js installation.
    pause
    exit /b 1
  )
) else (
  echo [1/4] node_modules found
)

if not exist dist (
  echo [2/4] Building project...
  call npm run build
  if errorlevel 1 (
    echo ERROR: build failed.
    pause
    exit /b 1
  )
) else (
  echo [2/4] dist found
)

echo [3/4] Starting preview server (http://localhost:8080)
start /B "BremenBackyard_Server" cmd /c "npm run preview -- --host 127.0.0.1 --port 8080 --strictPort"
timeout /t 5 /nobreak > nul

echo [4/4] Launching Chrome kiosk mode...
set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if "%CHROME%"=="" (
  echo ERROR: Chrome not found. Open http://localhost:8080 manually.
  pause
  exit /b 1
)

start "" "%CHROME%" ^
  --kiosk ^
  --app=http://localhost:8080 ^
  --autoplay-policy=no-user-gesture-required ^
  --no-first-run ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-translate ^
  --no-default-browser-check ^
  --disable-features=TranslateUI ^
  --use-fake-ui-for-media-stream

echo.
echo Exhibition started.
echo Server: http://localhost:8080
echo Close this window to stop.

:keepalive
ping -n 61 127.0.0.1 > nul
goto keepalive
