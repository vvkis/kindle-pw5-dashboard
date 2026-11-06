param([Parameter(Mandatory=$true)][string]$LibraryDir,[Parameter(Mandatory=$true)][string]$RuntimeDir)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null
$env:TEMP=Join-Path $RuntimeDir 'tmp'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$stopFile=Join-Path $RuntimeDir 'sensors.stop'
$outputFile=Join-Path $RuntimeDir 'sensors.json'
$lockPath=Join-Path $RuntimeDir 'sensors.lock'
$lock=$null
$computer=$null
try {
    # OS file lock prevents two elevated helpers from fighting over the driver.
    $lock=[IO.File]::Open($lockPath,'OpenOrCreate','ReadWrite','None')
    [Reflection.Assembly]::LoadFrom((Join-Path $LibraryDir 'LibreHardwareMonitorLib.dll')) | Out-Null
    $computer=New-Object LibreHardwareMonitor.Hardware.Computer
    $computer.IsCpuEnabled=$true
    $computer.IsGpuEnabled=$true
    # Leave motherboard, storage and SPD probing disabled; only read CPU/GPU sensors.
    $computer.Open()
    $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $started=Get-Date
    function Read-Hardware($hardware) {
        $hardware.Update()
        foreach($sensor in $hardware.Sensors) {
            if($null -ne $sensor.Value) {
                @{id=$sensor.Identifier.ToString();name=$sensor.Name;type=$sensor.SensorType.ToString();value=[double]$sensor.Value}
            }
        }
        foreach($child in $hardware.SubHardware) { Read-Hardware $child }
    }
    while(!(Test-Path -LiteralPath $stopFile)) {
        # Parent writes heartbeat. Exit if the desktop application crashed or stopped.
        $heartbeat=Join-Path $RuntimeDir 'heartbeat'
        if((Test-Path -LiteralPath $heartbeat) -and ((Get-Date)-(Get-Item -LiteralPath $heartbeat).LastWriteTime).TotalSeconds -gt 45) { break }
        if(((Get-Date)-$started).TotalHours -gt 24) { break }
        try {
            $sensors=@(foreach($hardware in $computer.Hardware) { Read-Hardware $hardware })
            $gpus=@($computer.Hardware | Where-Object { $_.HardwareType.ToString() -match '^Gpu' } | ForEach-Object { @{id=$_.Identifier.ToString();name=$_.Name} })
            $snapshot=@{at=[DateTime]::UtcNow.ToString('o');elevated=$admin;sensors=$sensors;gpus=$gpus;error=$null}
        } catch { $snapshot=@{at=[DateTime]::UtcNow.ToString('o');elevated=$admin;sensors=@();error=$_.Exception.Message} }
        $json=$snapshot | ConvertTo-Json -Depth 6 -Compress
        [IO.File]::WriteAllText("$outputFile.tmp",$json,(New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath "$outputFile.tmp" -Destination $outputFile -Force
        Start-Sleep -Seconds 3
    }
} catch {
    if($lock) {
        @{at=[DateTime]::UtcNow.ToString('o');sensors=@();error=$_.Exception.Message;elevated=$false} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $outputFile -Encoding UTF8
    }
} finally {
    if($computer) { $computer.Close() }
    if($lock) { $lock.Dispose() }
}
