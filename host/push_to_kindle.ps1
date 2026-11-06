# Requires Windows PowerShell 5.1+ or PowerShell 7, uv and Windows OpenSSH.
[CmdletBinding()]
param(
    [string]$KindleHost = '192.168.15.244',
    [ValidateRange(1, 65535)][int]$Port = 22,
    [string]$IdentityFile,
    [string]$DataFile,
    [string]$ImagePath,
    [string]$FontPath,
    [string]$At,
    [switch]$RenderOnly,
    [switch]$SkipRender
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$DataFile) { $DataFile = Join-Path $projectRoot 'data/demo.json' }
if (!$ImagePath) { $ImagePath = Join-Path $projectRoot 'out/dashboard.png' }
$ImagePath = [System.IO.Path]::GetFullPath($ImagePath)
if ($KindleHost -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*$') {
    throw 'KindleHost must be an IPv4 address or hostname.'
}

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

Get-Command uv -ErrorAction Stop | Out-Null
$renderArgs = @('run', '--cache-dir', (Join-Path $projectRoot '.uv-cache'), '--project', $projectRoot, '--locked', 'python', (Join-Path $PSScriptRoot 'render_dashboard.py'), '--out', $ImagePath)
if ($SkipRender) {
    $renderArgs += '--validate-only'
} else {
    $renderArgs += @('--data', $DataFile)
    if ($FontPath) { $renderArgs += @('--font', $FontPath) }
    if ($At) { $renderArgs += @('--at', $At) }
}
Invoke-Checked 'uv' $renderArgs
if ($RenderOnly) { Write-Output 'Render complete; no SSH connection attempted.'; return }

Get-Command ssh, scp -ErrorAction Stop | Out-Null
# Keep normal known_hosts verification. First establish trust with an interactive ssh login.
$options = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2')
if ($IdentityFile) {
    if (!(Test-Path -LiteralPath $IdentityFile -PathType Leaf)) { throw 'IdentityFile not found.' }
    $options += @('-i', [System.IO.Path]::GetFullPath($IdentityFile))
}
$target = "root@$KindleHost"
$remoteTemp = '/mnt/us/dashboard.' + [guid]::NewGuid().ToString('N') + '.tmp.png'
$sshArgs = $options + @('-p', "$Port", $target)

# eips and /mnt/us must be usable before uploading; no firmware or system settings changed.
Invoke-Checked 'ssh' ($sshArgs + @('test -d /mnt/us && test -w /mnt/us && command -v eips >/dev/null'))
try {
    # -O uses legacy SCP, compatible with Kindle Dropbear setups lacking an SFTP subsystem.
    # Run scp from the image directory so Windows drive-letter paths are not parsed as hosts.
    Push-Location -LiteralPath (Split-Path -Parent $ImagePath)
    try {
        Invoke-Checked 'scp' ($options + @('-O', '-P', "$Port", ('./' + (Split-Path -Leaf $ImagePath)), "${target}:$remoteTemp"))
    } finally { Pop-Location }
    Invoke-Checked 'ssh' ($sshArgs + @("test -s '$remoteTemp' && mv '$remoteTemp' /mnt/us/dashboard.png && eips -f -g /mnt/us/dashboard.png"))
    Write-Output 'Image pushed and refresh command completed.'
} finally {
    # Only remove this invocation's temporary file. Preserve the last dashboard on upload failure.
    & ssh @sshArgs "rm -f '$remoteTemp'"
    if ($LASTEXITCODE -ne 0) { Write-Warning "Temporary file cleanup failed: $remoteTemp" }
}
