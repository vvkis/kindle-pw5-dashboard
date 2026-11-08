param([string]$Application)

$ErrorActionPreference='Stop'
$env:PSModulePath="$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules;$env:ProgramFiles\WindowsPowerShell\Modules;$env:PSModulePath"
$root=Split-Path -Parent $PSScriptRoot
$env:TEMP=Join-Path $root 'out/tmp'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$package=Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (!$Application) { $Application=Join-Path $root 'dist/release/win-unpacked' }
$application=(Resolve-Path -LiteralPath $Application).Path
if(!(Test-Path -LiteralPath (Join-Path $application 'Kindle Monitor.exe'))){throw 'Run pnpm release first.'}
$archive=Join-Path $root ("dist/Kindle-Monitor-"+$package.version+'-win-x64.zip')
$entries=@(Get-ChildItem -LiteralPath $application -Force | Where-Object {$_.Name -notin @('Kindle Monitor Data','debug.log')})
Compress-Archive -LiteralPath $entries.FullName -DestinationPath $archive -CompressionLevel Optimal -Force
# Verify the release does not accidentally include local settings or diagnostics.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{
    $bad=@($zip.Entries | Where-Object {
        $_.FullName -match '(^|[\\/])(Kindle Monitor Data|settings\.json|ai-usage\.bin|ai-codex|tests?|smoke-[^\\/]+|[^\\/]+\.before-[^\\/]*)([\\/]|$)|\.(bak|tmp|log|ttf|otf|ttc)$'
    })
    if($bad.Count){throw 'Release contains local data.'}
    if(!($zip.Entries | Where-Object {$_.FullName -eq 'Kindle Monitor.exe'})){throw 'Release executable missing.'}
}finally{$zip.Dispose()}

$plugin=Join-Path $root 'kindle-plugin/dashboard.koplugin'
$pluginArchive=Join-Path $root ("dist/Kindle-Dashboard-Plugin-"+$package.version+'.zip')
Compress-Archive -LiteralPath $plugin -DestinationPath $pluginArchive -CompressionLevel Optimal -Force
$zip=[IO.Compression.ZipFile]::OpenRead($pluginArchive)
try{
    $files=@($zip.Entries | Where-Object Name | ForEach-Object {$_.FullName.Replace('\','/')})
    $expected=@('dashboard.koplugin/_meta.lua','dashboard.koplugin/main.lua','dashboard.koplugin/protocol.lua')
    if(Compare-Object $expected $files){throw 'Plugin ZIP contents do not match the installable folder.'}
}finally{$zip.Dispose()}

foreach($asset in @($archive,$pluginArchive)){
    $hash=(Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($asset))" | Set-Content -LiteralPath "$asset.sha256" -Encoding ascii
    Write-Output "Clean release: $asset"
}
