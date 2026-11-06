param([int]$Seconds=60,[switch]$Legacy)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$name=if($Legacy){'legacy'}else{'native'}
$dir=Join-Path $root ('runtime/helper-benchmark-'+$name)
New-Item -ItemType Directory -Force $dir | Out-Null
Remove-Item -LiteralPath (Join-Path $dir 'sensors.stop') -Force -ErrorAction SilentlyContinue
if($Legacy){
    $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $root 'desktop/sensor-helper.ps1')+'"'),'-LibraryDir',('"'+(Join-Path $root 'vendor/lhm')+'"'),'-RuntimeDir',('"'+$dir+'"'))
    $process=Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
}else{
    $arguments=@(('"'+(Join-Path $root 'vendor/lhm')+'"'),('"'+$dir+'"'))
    $process=Start-Process (Join-Path $root 'vendor/sensors/SensorHelper.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
}
try {
    Start-Sleep -Seconds 10
    $process.Refresh()
    $startCpu=$process.TotalProcessorTime.TotalSeconds
    $timer=[Diagnostics.Stopwatch]::StartNew()
    $working=@();$private=@()
    while($timer.Elapsed.TotalSeconds -lt $Seconds) {
        Start-Sleep -Seconds 1
        $process.Refresh()
        if($process.HasExited) { throw 'Helper exited unexpectedly' }
        $working+=($process.WorkingSet64/1MB)
        $private+=($process.PrivateMemorySize64/1MB)
    }
    $process.Refresh()
    $cpu=$process.TotalProcessorTime.TotalSeconds-$startCpu
    $sample=Get-Content -LiteralPath (Join-Path $dir 'sensors.json') -Raw | ConvertFrom-Json
    $report=@{durationSeconds=$timer.Elapsed.TotalSeconds;cpuSeconds=$cpu;wholeMachinePercent=($cpu/$timer.Elapsed.TotalSeconds/[Environment]::ProcessorCount*100);workingSetMiB=@{mean=($working|Measure-Object -Average).Average;max=($working|Measure-Object -Maximum).Maximum};privateMemoryMiB=@{mean=($private|Measure-Object -Average).Average;max=($private|Measure-Object -Maximum).Maximum};elevated=$sample.elevated;cpuTemperatureAvailable=@($sample.sensors|Where-Object { $_.type -eq 'Temperature' -and $_.id -match 'cpu' -and $_.value -gt 0 }).Count -gt 0;scope='60s steady-state after 10s warmup; actual built-in helper at current privileges. Full CPU temperature driver path requires separate elevated test.'}
    $report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root ('out/benchmark-helper-'+$name+'.json')) -Encoding UTF8
    $report|ConvertTo-Json -Depth 5
} finally {Set-Content -LiteralPath (Join-Path $dir 'sensors.stop') -Value stop}
