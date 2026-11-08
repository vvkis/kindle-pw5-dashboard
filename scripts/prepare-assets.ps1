$ErrorActionPreference='Stop'
$env:PSModulePath="$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules;$env:ProgramFiles\WindowsPowerShell\Modules;$env:PSModulePath"
$root=Split-Path -Parent $PSScriptRoot
$env:TEMP=Join-Path $root 'out/tmp'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$vendor=Join-Path $root 'vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null
function Fetch-Zip([string]$Url,[string]$Name,[string]$Hash,[string]$Folder) {
    $archive=Join-Path $vendor $Name
    if(!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing }
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw "Hash mismatch: $Name" }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $vendor $Folder) -Force
}
Fetch-Zip 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip' 'lhm.zip' '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001' 'lhm'
$sensorDir=Join-Path $vendor 'sensors'
New-Item -ItemType Directory -Force $sensorDir | Out-Null
$pawnInstaller=Join-Path $sensorDir 'PawnIO_setup.exe'
if(!(Test-Path -LiteralPath $pawnInstaller)){
    Invoke-WebRequest -UseBasicParsing 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe' -OutFile $pawnInstaller
}
if((Get-FileHash -LiteralPath $pawnInstaller -Algorithm SHA256).Hash -ne '1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032'){throw 'PawnIO installer hash mismatch.'}
$pawnSignature=Get-AuthenticodeSignature -LiteralPath $pawnInstaller
if($pawnSignature.Status -ne 'Valid' -or $pawnSignature.SignerCertificate.Subject -notmatch 'CN=namazso\.eu(?:,|$)'){throw 'PawnIO signature verification failed.'}
Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/namazso/PawnIO/master/COPYING' -OutFile (Join-Path $sensorDir 'LICENSE-PawnIO.txt')
@'
PawnIO 2.2.0 official signed installer; unmodified.
https://github.com/namazso/PawnIO.Setup/releases/tag/2.2.0
SHA256: 1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032
Driver source: https://github.com/namazso/PawnIO
License and source distribution terms: LICENSE-PawnIO.txt and upstream repository.
'@ | Set-Content -LiteralPath (Join-Path $sensorDir 'SOURCE.txt') -Encoding UTF8
# Retain all upstream licensing notices. DLLs are build assets, never Git source files.
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
Remove-Item -LiteralPath (Join-Path $vendor 'lhm.zip') -Force -ErrorAction SilentlyContinue
Write-Output 'Verified sensor library assets are ready.'
