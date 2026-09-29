# Build the React SPA and copy into api/spa_dist (bundled in the Python package).
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$frontend = Join-Path $repoRoot "frontend"
$spaDist = Join-Path $repoRoot "backend\api\spa_dist"

Push-Location $frontend
try {
    if (-not (Test-Path "node_modules")) { npm install }
    npm run build
} finally {
    Pop-Location
}

if (Test-Path $spaDist) { Remove-Item -Recurse -Force $spaDist }
Copy-Item -Recurse (Join-Path $frontend "dist") $spaDist
Write-Host "SPA copied to backend/api/spa_dist - run fastapi deploy from backend/"
