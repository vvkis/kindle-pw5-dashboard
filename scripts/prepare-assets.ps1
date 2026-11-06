$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$vendor=Join-Path $root 'vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null
function Fetch-Zip([string]$Url,[string]$Name,[string]$Hash,[string]$Folder) {
    $archive=Join-Path $vendor $Name
    if(!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing }
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw "Hash mismatch: $Name" }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $vendor $Folder) -Force
}
Fetch-Zip 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip' 'lhm.zip' '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001' 'lhm'
Fetch-Zip 'https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-NF-CN.zip' 'maple.zip' 'af913b6322905348b3f50e4397fedc35b3a880db5effcce7969003051dcd3e94' 'fonts'
# Retain all upstream licensing notices. DLLs and fonts are build assets, never Git source files.
$headers=@{'User-Agent'='Kindle-Monitor-build'}
$files=Invoke-RestMethod -Uri 'https://api.github.com/repos/LibreHardwareMonitor/LibreHardwareMonitor/contents?ref=v0.9.6' -Headers $headers
foreach($file in $files) {
    if($file.type -eq 'file' -and $file.name -match 'LICENSE|THIRD-PARTY') {
        Invoke-WebRequest -Uri $file.download_url -OutFile (Join-Path $vendor ('lhm/'+$file.name)) -UseBasicParsing
    }
}
@'
LibreHardwareMonitor v0.9.6
https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6
Release SHA256: 086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001
Unmodified upstream DLLs. See LICENSE and third-party notices alongside these files.
'@ | Set-Content -LiteralPath (Join-Path $vendor 'lhm/SOURCE.txt') -Encoding UTF8
Write-Output 'Verified sensor library and Maple Mono NF CN assets are ready.'
