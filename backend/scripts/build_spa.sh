#!/usr/bin/env bash
# Build the React SPA and copy into api/spa_dist (for FastAPI Cloud deploy / CI).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
frontend="$repo_root/frontend"
spa_dist="$repo_root/backend/api/spa_dist"

cd "$frontend"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

rm -rf "$spa_dist"
cp -r "$frontend/dist" "$spa_dist"
echo "SPA copied to backend/api/spa_dist"
