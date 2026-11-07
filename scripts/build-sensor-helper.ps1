$ErrorActionPreference='Stop'
$env:PSModulePath="$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules;$env:ProgramFiles\WindowsPowerShell\Modules;$env:PSModulePath"
$root=Split-Path -Parent $PSScriptRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$library=Join-Path $root 'vendor/lhm/LibreHardwareMonitorLib.dll'
$output=Join-Path $root 'vendor/sensors'
if(!(Test-Path -LiteralPath $compiler)){throw 'Windows .NET Framework compiler not found.'}
if(!(Test-Path -LiteralPath $library)){throw 'Run pnpm prepare:assets before building the sensor helper.'}
New-Item -ItemType Directory -Force $output | Out-Null
$installer=Join-Path $output 'PawnIO_setup.exe'
if(!(Test-Path -LiteralPath $installer)){throw 'Run pnpm prepare:assets to bundle the CPU temperature driver.'}
if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne '1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032'){throw 'CPU temperature driver hash mismatch.'}
[IO.File]::WriteAllText((Join-Path $output 'EnableSensors.ps1'),[IO.File]::ReadAllText((Join-Path $root 'desktop/EnableSensors.ps1')),(New-Object Text.UTF8Encoding($true)))
& $compiler /nologo /target:winexe /optimize+ ("/out:"+(Join-Path $output 'SensorHelper.exe')) ("/reference:"+$library) /reference:System.Web.Extensions.dll (Join-Path $root 'desktop/SensorHelper.cs')
if($LASTEXITCODE -ne 0){throw 'Sensor helper compilation failed.'}
'<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.7.2"/></startup></configuration>' | Set-Content -LiteralPath (Join-Path $output 'SensorHelper.exe.config') -Encoding UTF8
Write-Output 'Built native sensor helper using the existing Windows .NET Framework.'
