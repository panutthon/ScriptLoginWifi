$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName "WifiAutoLogin" -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Scheduled task 'WifiAutoLogin' not found — nothing to remove."
    exit 0
}

Unregister-ScheduledTask -TaskName "WifiAutoLogin" -Confirm:$false
Write-Host "Removed scheduled task 'WifiAutoLogin'."
