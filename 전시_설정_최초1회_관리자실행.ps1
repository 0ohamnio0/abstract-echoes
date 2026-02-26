#Requires -RunAsAdministrator
# ═══════════════════════════════════════════════════════════
#  Abstract Echoes — 전시 환경 1회 초기 설정 스크립트
#  반드시 관리자 권한으로 실행하세요 (우클릭 → 관리자로 실행)
# ═══════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$BAT_PATH = "D:\오브레멘\abstract-echoes-main\전시_시작.bat"

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Abstract Echoes 전시 환경 초기 설정"     -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ─────────────────────────────────────────
# [1/5] Chrome 자동 업데이트 차단
# ─────────────────────────────────────────
Write-Host "[1/5] Chrome 자동 업데이트 차단 중..." -ForegroundColor Yellow

$googleUpdatePath = "HKLM:\SOFTWARE\Policies\Google\Update"
New-Item -Path $googleUpdatePath -Force | Out-Null
Set-ItemProperty -Path $googleUpdatePath -Name "AutoUpdateCheckPeriodMinutes" -Value 0    -Type DWord -Force
Set-ItemProperty -Path $googleUpdatePath -Name "DisableAutoUpdateChecksCheckboxValue" -Value 1 -Type DWord -Force
Set-ItemProperty -Path $googleUpdatePath -Name "UpdateDefault"                -Value 0    -Type DWord -Force

Write-Host "    완료" -ForegroundColor Green

# ─────────────────────────────────────────
# [2/5] Chrome 마이크 권한 자동 허용 정책
# ─────────────────────────────────────────
Write-Host "[2/5] Chrome localhost 마이크 권한 자동 허용 설정 중..." -ForegroundColor Yellow

$chromePolicyPath = "HKLM:\SOFTWARE\Policies\Google\Chrome"
New-Item -Path $chromePolicyPath -Force | Out-Null
Set-ItemProperty -Path $chromePolicyPath -Name "AudioCaptureAllowed" -Value 1 -Type DWord -Force

# AudioCaptureAllowedUrls — localhost 마이크 자동 허용
$audioUrlsPath = "$chromePolicyPath\AudioCaptureAllowedUrls"
New-Item -Path $audioUrlsPath -Force | Out-Null
Set-ItemProperty -Path $audioUrlsPath -Name "1" -Value "http://localhost:8080" -Type String -Force

Write-Host "    완료" -ForegroundColor Green

# ─────────────────────────────────────────
# [3/5] Windows Update 35일 유예
# ─────────────────────────────────────────
Write-Host "[3/5] Windows Update 유예 설정 중 (35일)..." -ForegroundColor Yellow

$wuuxPath = "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
New-Item -Path $wuuxPath -Force | Out-Null
Set-ItemProperty -Path $wuuxPath -Name "DeferFeatureUpdatesPeriodInDays"  -Value 35 -Type DWord -Force
Set-ItemProperty -Path $wuuxPath -Name "DeferQualityUpdatesPeriodInDays"  -Value 35 -Type DWord -Force
# 활성 시간 0~23시로 설정 (사실상 전체 시간 활성 → 자동 재시작 방지)
Set-ItemProperty -Path $wuuxPath -Name "ActiveHoursStart" -Value 0  -Type DWord -Force
Set-ItemProperty -Path $wuuxPath -Name "ActiveHoursEnd"   -Value 23 -Type DWord -Force

# Windows Update 서비스 수동 시작으로 변경
Stop-Service  -Name "wuauserv" -Force -ErrorAction SilentlyContinue
Set-Service   -Name "wuauserv" -StartupType Manual

Write-Host "    완료" -ForegroundColor Green

# ─────────────────────────────────────────
# [4/5] 절전/화면보호기 비활성화
# ─────────────────────────────────────────
Write-Host "[4/5] 절전 모드 및 화면보호기 비활성화 중..." -ForegroundColor Yellow

# 모니터 끄기 / 절전 / 최대 절전 모두 해제
powercfg /change monitor-timeout-ac 0  | Out-Null
powercfg /change monitor-timeout-dc 0  | Out-Null
powercfg /change standby-timeout-ac 0  | Out-Null
powercfg /change standby-timeout-dc 0  | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-dc 0 | Out-Null

# 화면보호기 비활성화
$regDesktop = "HKCU:\Control Panel\Desktop"
Set-ItemProperty -Path $regDesktop -Name "ScreenSaveActive"   -Value "0"
Set-ItemProperty -Path $regDesktop -Name "ScreenSaverIsSecure" -Value "0"

Write-Host "    완료" -ForegroundColor Green

# ─────────────────────────────────────────
# [5/5] 로그인 시 자동 시작 등록 (Task Scheduler)
# ─────────────────────────────────────────
Write-Host "[5/5] 부팅 자동 시작 등록 중..." -ForegroundColor Yellow

$taskName = "AbstractEchoes_전시시작"

# 기존 작업 있으면 제거
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action   = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BAT_PATH`""
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName  $taskName `
    -Action    $action `
    -Trigger   $trigger `
    -Settings  $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host "    완료 — 로그인 시 자동 시작 등록됨" -ForegroundColor Green

# ─────────────────────────────────────────
# 완료 메시지
# ─────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  설정 완료!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  다음 단계:" -ForegroundColor White
Write-Host "  1. PC를 재부팅하면 전시가 자동 시작됩니다." -ForegroundColor Gray
Write-Host "  2. 첫 실행 시 Chrome에서 마이크 권한 허용을 눌러주세요." -ForegroundColor Gray
Write-Host "  3. 전시 모드 종료: Ctrl+Shift+K (세팅 모드 진입)" -ForegroundColor Gray
Write-Host "  4. 코드 수정 후 재빌드: dist 폴더 삭제 후 전시_시작.bat 재실행" -ForegroundColor Gray
Write-Host ""

Read-Host "Enter를 누르면 닫힙니다"
