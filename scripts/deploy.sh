#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_host="${D500_SSH_HOST:-d500-host}"
task_release="$(git -C "$task_root" rev-parse --short=12 HEAD)"
cd "$task_root"
test -z "$(git status --porcelain --untracked-files=no)" || { echo 'Commit source changes before deploying.' >&2; exit 1; }
npm run build
node scripts/package-release.mjs
ssh "$task_host" "mkdir -p /opt/d500-web/releases/$task_release"
tar -C dist -czf - . | ssh "$task_host" "tar -xzf - -C /opt/d500-web/releases/$task_release"
scp deploy/compose.yml "$task_host:/opt/d500-web/compose.yml"
scp deploy/nginx.conf "$task_host:/opt/d500-web/nginx.conf"
ssh "$task_host" bash -s -- "$task_release" <<'REMOTE'
set -euo pipefail
cd /opt/d500-web
if [ -L current ]; then readlink current > previous-release; fi
ln -sfn "releases/$1" current.next
mv -Tf current.next current
docker compose up -d --force-recreate d500-web
docker exec d500-web nginx -t
for task_try in {1..15}; do
  if docker exec d500-web wget -q -O - http://127.0.0.1:8080/health; then exit 0; fi
  sleep 1
done
echo 'Health check failed; the previous release remains available for rollback.' >&2
exit 1
REMOTE
echo "Deployed $task_release. Verify https://d500.example.com/version.json"
