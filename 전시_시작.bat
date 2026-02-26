@echo off
chcp 65001 > nul
title Abstract Echoes — 전시 서버

cd /d D:\오브레멘\abstract-echoes-main

:: ─────────────────────────────────────────
:: [1/4] node_modules 확인
:: ─────────────────────────────────────────
if not exist node_modules (
    echo [1/4] 패키지 설치 중 ^(최초 1회^)...
    call npm install
    if errorlevel 1 (
        echo 오류: npm install 실패. Node.js가 설치되어 있는지 확인하세요.
        pause
        exit /b 1
    )
) else (
    echo [1/4] node_modules 확인 완료
)

:: ─────────────────────────────────────────
:: [2/4] 빌드 확인 (dist 없으면 빌드)
:: ─────────────────────────────────────────
if not exist dist (
    echo [2/4] 빌드 시작 ^(최초 1회^)...
    call npm run build
    if errorlevel 1 (
        echo 오류: 빌드 실패.
        pause
        exit /b 1
    )
) else (
    echo [2/4] 빌드 파일 확인 완료 ^(dist 존재^)
)

:: ─────────────────────────────────────────
:: [3/4] 서버 시작
:: ─────────────────────────────────────────
echo [3/4] 전시 서버 시작 중... ^(http://localhost:8080^)
start /B "AbstractEchoes_Server" cmd /c "npm run preview"

echo     서버 초기화 대기 중 ^(5초^)...
timeout /t 5 /nobreak > nul

:: ─────────────────────────────────────────
:: [4/4] Chrome 키오스크 모드 실행
:: ─────────────────────────────────────────
echo [4/4] Chrome 키오스크 모드로 실행 중...

set CHROME=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if "%CHROME%"=="" (
    echo 오류: Chrome을 찾을 수 없습니다.
    echo 직접 브라우저에서 http://localhost:8080 을 열어주세요.
    pause
    exit /b 1
)

start "" %CHROME% ^
    --kiosk ^
    --app=http://localhost:8080 ^
    --autoplay-policy=no-user-gesture-required ^
    --no-first-run ^
    --noerrdialogs ^
    --disable-infobars ^
    --disable-session-crashed-bubble ^
    --disable-translate ^
    --no-default-browser-check ^
    --disable-features=TranslateUI

echo.
echo ════════════════════════════════════════
echo   전시 시작됨
echo   서버: http://localhost:8080
echo   종료하려면 이 창을 닫으세요
echo ════════════════════════════════════════

:: 서버 프로세스가 종료되지 않도록 대기
:keepalive
timeout /t 60 /nobreak > nul
goto keepalive
