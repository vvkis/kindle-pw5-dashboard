$ErrorActionPreference='Stop'
$env:PSModulePath="$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules;$env:ProgramFiles\WindowsPowerShell\Modules;$env:PSModulePath"
$root=Split-Path -Parent $PSScriptRoot
$package=Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$application=Join-Path $root 'dist/release/win-unpacked'
if(!(Test-Path -LiteralPath (Join-Path $application 'Kindle Monitor.exe'))){throw 'Run pnpm release first.'}
$archive=Join-Path $root ("dist/Kindle-Monitor-"+$package.version+'-win-x64.zip')
$entries=@(Get-ChildItem -LiteralPath $application -Force | Where-Object {$_.Name -notin @('Kindle Monitor Data','debug.log')})
Compress-Archive -LiteralPath $entries.FullName -DestinationPath $archive -CompressionLevel Optimal -Force
# Verify the release does not accidentally include local settings or diagnostics.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{
    $bad=@($zip.Entries | Where-Object {$_.FullName -match '(^|[\\/])(Kindle Monitor Data|settings\.json|debug\.log)([\\/]|$)'})
    if($bad.Count){throw 'Release contains local data.'}
    if(!($zip.Entries | Where-Object {$_.FullName -eq 'Kindle Monitor.exe'})){throw 'Release executable missing.'}
}finally{$zip.Dispose()}
Write-Output "Clean release: $archive"
