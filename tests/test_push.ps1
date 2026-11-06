# Test command ordering and failures without contacting a device.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptUnderTest = Join-Path (Split-Path -Parent $PSScriptRoot) 'host/push_to_kindle.ps1'
$global:calls = [System.Collections.Generic.List[string]]::new()
$global:failScp = $false
$global:failUv = $false
function global:uv { $global:calls.Add('uv ' + ($args -join ' ')); $global:LASTEXITCODE = [int]$global:failUv }
function global:ssh { $global:calls.Add('ssh ' + ($args -join ' ')); $global:LASTEXITCODE = 0 }
function global:scp { $global:calls.Add('scp ' + ($args -join ' ')); $global:LASTEXITCODE = [int]$global:failScp }
function Assert([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }

& $scriptUnderTest -RenderOnly
Assert ($global:calls.Count -eq 1) 'RenderOnly must not connect to a device'
$global:calls.Clear()
& $scriptUnderTest -SkipRender
Assert ($global:calls[0] -match '--validate-only') 'SkipRender must validate the existing PNG'
Assert ($global:calls[1] -match 'command -v eips') 'Preflight must precede upload'
Assert ($global:calls[2] -match '^scp .* -O .*dashboard\..*tmp.png') 'Upload must use legacy SCP and a temporary path'
Assert ($global:calls[3] -match "mv .* && eips -f -g") 'Promote only after upload then refresh'
Assert ($global:calls[4] -match 'rm -f') 'Clean up only the per-run temporary file'
Assert (($global:calls -join ' ') -notmatch 'StrictHostKeyChecking=no') 'Must verify host identity'

$global:calls.Clear()
$global:failScp = $true
$failed = $false
try { & $scriptUnderTest } catch { $failed = $true }
Assert $failed 'Upload failure must propagate'
Assert (($global:calls -join ' ') -notmatch '&& mv') 'Must not replace dashboard after upload failure'
Assert ($global:calls[-1] -match 'rm -f') 'Must attempt cleanup after failed upload'

$global:calls.Clear()
$global:failScp = $false
$global:failUv = $true
$failed = $false
try { & $scriptUnderTest } catch { $failed = $true }
Assert ($failed -and $global:calls.Count -eq 1) 'Render failure must stop before SSH'

$global:calls.Clear()
$failed = $false
try { & $scriptUnderTest -KindleHost 'host;bad' } catch { $failed = $true }
Assert ($failed -and $global:calls.Count -eq 0) 'Reject invalid hostname before invoking tools'
Write-Output 'PASS: render-only, upload ordering, PNG validation, host key checks, failure cleanup, invalid hostname'
