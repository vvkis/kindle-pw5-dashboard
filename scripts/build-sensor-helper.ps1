$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$library=Join-Path $root 'vendor/lhm/LibreHardwareMonitorLib.dll'
$output=Join-Path $root 'vendor/sensors'
if(!(Test-Path -LiteralPath $compiler)){throw 'Windows .NET Framework compiler not found.'}
if(!(Test-Path -LiteralPath $library)){throw 'Run pnpm prepare:assets before building the sensor helper.'}
New-Item -ItemType Directory -Force $output | Out-Null
& $compiler /nologo /target:winexe /optimize+ ("/out:"+(Join-Path $output 'SensorHelper.exe')) ("/reference:"+$library) /reference:System.Web.Extensions.dll (Join-Path $root 'desktop/SensorHelper.cs')
if($LASTEXITCODE -ne 0){throw 'Sensor helper compilation failed.'}
'<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.7.2"/></startup></configuration>' | Set-Content -LiteralPath (Join-Path $output 'SensorHelper.exe.config') -Encoding UTF8
Write-Output 'Built native sensor helper using the existing Windows .NET Framework.'
