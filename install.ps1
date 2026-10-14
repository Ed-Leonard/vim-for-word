<#
.SYNOPSIS
  vimword installer (Windows). Safe to re-run. Mirrors install.sh.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
  powershell -ExecutionPolicy Bypass -File install.ps1 -ChromeId <32-char id>
  powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$ChromeId = "",   # register the host for a Chrome extension with this ID and save it
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"

$Name         = "com.typo.vimword"
$FfId         = "vimword@typo"   # must match gecko.id in extension/manifest.firefox.json
$Repo         = $PSScriptRoot
$Prefix       = Join-Path $env:LOCALAPPDATA "vimword"
$ChromeIdFile = Join-Path $Prefix "chrome-extension-id"

# Each browser looks the host up under its own registry key; the value is the manifest path.
$FirefoxKey   = "HKCU:\Software\Mozilla\NativeMessagingHosts\$Name"
$ChromiumKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$Name",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$Name",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$Name",
  "HKCU:\Software\Chromium\NativeMessagingHosts\$Name"
)

if ($Uninstall) {
  foreach ($k in (@($FirefoxKey) + $ChromiumKeys)) {
    if (Test-Path $k) { Remove-Item $k -Recurse -Force }
  }
  if (Test-Path $Prefix) { Remove-Item $Prefix -Recurse -Force }
  Write-Host "Removed vimword native host registration and $Prefix"
  return
}

# Real python.exe path. Skips the Microsoft Store stub, which exits non-zero when not installed.
function Find-Python {
  foreach ($c in @(@{ Cmd = "py"; Args = @("-3") }, @{ Cmd = "python"; Args = @() })) {
    if (-not (Get-Command $c.Cmd -ErrorAction SilentlyContinue)) { continue }
    try {
      $exe = & $c.Cmd @($c.Args) -c "import sys; print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Path $exe)) { return $exe.Trim() }
    } catch { }
  }
  throw "Python 3 is required (install it from python.org) and re-run."
}
$py = Find-Python

# 1. Host files. The Windows backend uses only ctypes, so there is no venv and no pip.
Write-Host "==> Installing host to $Prefix"
New-Item -ItemType Directory -Force $Prefix | Out-Null

if (-not $ChromeId -and (Test-Path $ChromeIdFile)) {
  $ChromeId = (Get-Content $ChromeIdFile -Raw).Trim()
} elseif ($ChromeId) {
  Set-Content -Path $ChromeIdFile -Value $ChromeId -Encoding ASCII
}

Remove-Item (Join-Path $Prefix "injector") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $Repo "host\*") $Prefix -Recurse -Force

# 2. Wrapper: the manifest "path" cannot take arguments or choose an interpreter. The
#    browser's PATH can differ from yours, so the absolute python.exe is baked in.
$wrapper    = Join-Path $Prefix "vimword-host.bat"
$hostScript = Join-Path $Prefix "vimword_host.py"
"@echo off`r`n`"$py`" -u `"$hostScript`" %*`r`n" | Set-Content -Encoding OEM $wrapper

# 3. Native messaging manifests + registry.
function Write-Manifest($file, $allowKey, $allowValue) {
  $m = [ordered]@{
    name        = $Name
    description = "vimword key injector"
    path        = $wrapper
    type        = "stdio"
  }
  $m[$allowKey] = @($allowValue)
  $json = $m | ConvertTo-Json -Depth 5
  # UTF-8 without a BOM: browsers can reject a BOM in the manifest.
  [System.IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Register($key, $manifest) {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(default)" -Value $manifest
  Write-Host "    registered $key"
}

Write-Host "==> Registering native messaging host"
$ffManifest = Join-Path $Prefix "$Name.firefox.json"
Write-Manifest $ffManifest "allowed_extensions" $FfId
Register $FirefoxKey $ffManifest

if ($ChromeId) {
  $chManifest = Join-Path $Prefix "$Name.chrome.json"
  Write-Manifest $chManifest "allowed_origins" "chrome-extension://$ChromeId/"
  foreach ($k in $ChromiumKeys) { Register $k $chManifest }
}

# 4. Build the extension and self-test the host.
& (Join-Path $Repo "build.ps1")
Write-Host "==> Self-test"
& $wrapper --check
if ($LASTEXITCODE -ne 0) { Write-Warning "self-test failed (see message above)" }

Write-Host @"
 
Done. Next:
  Firefox: about:debugging -> This Firefox -> Load Temporary Add-on -> $Repo\dist\firefox\manifest.json
           (permanent install needs a signed build, see README)
  Chrome:  chrome://extensions -> Developer mode -> Load unpacked -> $Repo\dist\chrome
           then: .\install.ps1 -ChromeId <the ID shown there> (saved for future installs)
"@