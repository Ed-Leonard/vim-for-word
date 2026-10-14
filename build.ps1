# Assemble per-browser extension folders in dist\. Windows port of build.sh.
$ErrorActionPreference = "Stop"
$Repo = $PSScriptRoot
$Dist = Join-Path $Repo "dist"
 
if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
foreach ($t in @("firefox", "chrome")) {
  $out = Join-Path $Dist $t
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item (Join-Path $Repo "extension\src\*.js") $out
  Copy-Item (Join-Path $Repo "extension\manifest.$t.json") (Join-Path $out "manifest.json")
}
Write-Host "built dist\firefox and dist\chrome"