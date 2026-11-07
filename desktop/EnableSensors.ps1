param(
    [Parameter(Mandatory=$true)][string]$Library,
    [Parameter(Mandatory=$true)][string]$Runtime,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f-]{36}$')][string]$Operation
)
$ErrorActionPreference='Stop'
$env:PSModulePath="$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules;$env:ProgramFiles\WindowsPowerShell\Modules;$env:PSModulePath"
$installerHash='1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032'
$statusPath=Join-Path $Runtime 'sensor-start.json'
$stopPath=Join-Path $Runtime 'sensors.stop'
$lockPath=Join-Path $Runtime 'sensors.lock'
$sensorPath=Join-Path $Runtime 'sensors.json'
$helper=Join-Path $PSScriptRoot 'SensorHelper.exe'
$installer=Join-Path $PSScriptRoot 'PawnIO_setup.exe'
function Write-Status([string]$Phase,[string]$Message) {
    $json=@{operation=$Operation;phase=$Phase;message=$Message;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json
    $tempPath=$statusPath+'.tmp'
    [IO.File]::WriteAllText($tempPath,$json,(New-Object Text.UTF8Encoding($false)))
    if(Test-Path -LiteralPath $statusPath){[IO.File]::Replace($tempPath,$statusPath,($statusPath+'.previous'))}else{[IO.File]::Move($tempPath,$statusPath)}
}
New-Item -ItemType Directory -Path $Runtime -Force | Out-Null
Start-Transcript -Path (Join-Path $Runtime 'sensor-setup.log') -Append | Out-Null
try {
    $admin=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if(-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw '需要管理员授权才能准备温度采集器。'}
    Write-Status 'preparing' '正在准备 CPU 温度采集器…'
    # Stop only our own helper using its cooperative shutdown file and lock.
    [IO.File]::WriteAllText($stopPath,'stop')
    $lockAvailable=$false
    for($i=0;$i -lt 50;$i++){
        try{$handle=[IO.File]::Open($lockPath,'OpenOrCreate','ReadWrite','None');$handle.Dispose();$lockAvailable=$true;break}catch [IO.IOException]{Start-Sleep -Milliseconds 200}
    }
    if(-not $lockAvailable){throw '旧温度采集器未能退出，请退出 Kindle Monitor 后重试。'}
    $installed=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO' -ErrorAction SilentlyContinue
    if(-not $installed -or -not $installed.DisplayVersion -or [version]$installed.DisplayVersion -lt [version]'2.2.0'){
        Write-Status 'driver' '正在自动准备硬件访问组件，完成后直接开始采集…'
        if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $installerHash){throw '硬件访问组件校验失败，请重新准备应用资源。'}
        $signature=Get-AuthenticodeSignature -LiteralPath $installer
        if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=namazso\.eu(?:,|$)'){throw '硬件访问组件的官方签名验证失败。'}
        $setup=Start-Process -FilePath $installer -ArgumentList '-install','-silent' -WindowStyle Hidden -Wait -PassThru
        if($setup.ExitCode -eq 3010){Write-Status 'reboot-required' '温度驱动已准备好，需要重启 Windows。';exit 0}
        if($setup.ExitCode -ne 0){throw "硬件访问组件初始化失败，退出码 $($setup.ExitCode)。"}
    }
    $service=Get-Service -Name PawnIO -ErrorAction SilentlyContinue
    if(-not $service){throw '未找到硬件访问驱动服务，初始化未完成。'}
    if($service.Status -ne 'Running'){Start-Service -Name PawnIO}
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sensorPath -Force -ErrorAction SilentlyContinue
    Write-Status 'starting' '驱动已就绪，正在读取 CPU 温度…'
    $startedAt=[DateTime]::UtcNow
    Start-Process -FilePath $helper -ArgumentList ('"'+$Library+'" "'+$Runtime+'"') -WindowStyle Hidden | Out-Null
    for($i=0;$i -lt 80;$i++){
        Start-Sleep -Milliseconds 250
        $data=$null
        try{if(Test-Path -LiteralPath $sensorPath){$data=Get-Content -LiteralPath $sensorPath -Raw -Encoding UTF8 | ConvertFrom-Json}}catch{}
        if($data -and ([DateTime]$data.at).ToUniversalTime() -ge $startedAt.AddSeconds(-1)){
            $cpu=@($data.sensors | Where-Object {$_.type -eq 'Temperature' -and $_.id -match 'cpu' -and $_.value -gt 0 -and $_.value -lt 150})
            if($cpu.Count -gt 0){Write-Status 'ready' 'CPU 温度已连接';exit 0}
            if($data.error -and $data.errorCode -ne 'cpu-unavailable'){throw $data.error}
        }
    }
    throw '驱动已运行，但尚未读到有效 CPU 温度。请查看 sensors.json；可能需要适配此硬件。'
}catch{
    Write-Status 'error' $_.Exception.Message
    Write-Output $_.Exception.ToString()
    exit 1
}finally{Stop-Transcript | Out-Null}
