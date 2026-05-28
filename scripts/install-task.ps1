$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path "$PSScriptRoot\.."
$nodeExe     = (Get-Command node).Source
$scriptPath  = Join-Path $projectRoot "src\login.js"

if (-not (Test-Path $scriptPath)) {
    Write-Error "Could not find $scriptPath"
    exit 1
}

$action    = New-ScheduledTaskAction `
              -Execute $nodeExe `
              -Argument "`"$scriptPath`"" `
              -WorkingDirectory $projectRoot

$trigger   = New-ScheduledTaskTrigger -Daily -At "05:01"

$settings  = New-ScheduledTaskSettingsSet `
              -MultipleInstances IgnoreNew `
              -StartWhenAvailable:$false `
              -DontStopOnIdleEnd `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal `
              -UserId $env:USERNAME `
              -LogonType Interactive `
              -RunLevel Limited

Register-ScheduledTask `
  -TaskName "WifiAutoLogin" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Auto re-login to WiFi captive portal after 05:00 timeout" `
  -Force | Out-Null

Write-Host "Installed scheduled task 'WifiAutoLogin' (runs daily at 05:01)."
