@echo off
REM Bremen Backyard kiosk - daily reboot task installer
REM Run ONCE on the exhibition PC, as Administrator
REM   (right-click this file -> "Run as administrator")
REM
REM Creates a Windows scheduled task that reboots the PC every day at 05:00.
REM Prerequisites (already configured on the Bremen PC, see ops guide 51.09.02 sec.9):
REM   - auto-login (netplwiz)
REM   - shell:startup shortcut to Bremen_Kiosk.bat (minimized)
REM With those in place the exhibition comes back up unattended after each reboot.

net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: administrator rights required.
  echo Right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)

schtasks /Create /F /TN "BremenDailyReboot" ^
  /TR "shutdown /r /f /t 60 /c \"Bremen kiosk daily reboot\"" ^
  /SC DAILY /ST 05:00 /RU SYSTEM /RL HIGHEST

if errorlevel 1 (
  echo ERROR: failed to create the scheduled task.
  pause
  exit /b 1
)

echo.
echo OK: daily reboot scheduled at 05:00 (task name: BremenDailyReboot)
echo   check : schtasks /Query /TN "BremenDailyReboot"
echo   remove: schtasks /Delete /TN "BremenDailyReboot" /F
pause
