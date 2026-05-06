@echo off
chcp 65001 > nul
title Bremen Backyard — Production

set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if "%CHROME%"=="" (
  echo ERROR: Chrome not found.
  pause
  exit /b 1
)

set "URL=https://abstract-echoes.vercel.app"

start "" "%CHROME%" ^
  --kiosk ^
  --app=%URL% ^
  --autoplay-policy=no-user-gesture-required ^
  --use-fake-ui-for-media-stream ^
  --no-first-run ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-translate ^
  --no-default-browser-check ^
  --disable-features=TranslateUI ^
  --window-size=1720,1032

echo Exhibition started. D-plan Production.
echo URL: %URL%
echo Close this window to stop.

:keepalive
ping -n 61 127.0.0.1 > nul
goto keepalive
