#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_host="${D500_SSH_HOST:?Set D500_SSH_HOST to your SSH destination}"
task_release="$(git -C "$task_root" rev-parse --short=12 HEAD)"
task_transport=(-o BatchMode=yes -o ConnectTimeout=15)
if [ -n "${D500_SSH_PROXY_COMMAND:-}" ]; then
  task_transport+=(-o "ProxyCommand=$D500_SSH_PROXY_COMMAND")
fi
cd "$task_root"
test -z "$(git status --porcelain --untracked-files=no)" || { echo 'Commit source changes before deploying.' >&2; exit 1; }
npm run build
node scripts/package-release.mjs
ssh "${task_transport[@]}" "$task_host" "mkdir -p /opt/d500-web/releases/$task_release"
COPYFILE_DISABLE=1 tar --no-xattrs --no-acls -C dist -czf - . | ssh "${task_transport[@]}" "$task_host" "tar -xzf - -C /opt/d500-web/releases/$task_release"
scp "${task_transport[@]}" deploy/compose.yml "$task_host:/opt/d500-web/compose.yml"
scp "${task_transport[@]}" deploy/nginx.conf "$task_host:/opt/d500-web/nginx.conf"
ssh "${task_transport[@]}" "$task_host" bash -s -- "$task_release" <<'REMOTE'
set -euo pipefail
cd /opt/d500-web
if [ -L current ]; then readlink current > previous-release; fi
ln -sfn "releases/$1" current.next
mv -Tf current.next current
docker compose up -d --force-recreate d500-web
docker exec d500-web nginx -t
for task_try in {1..15}; do
  if docker exec d500-web wget -q -O - http://127.0.0.1:8080/health; then
    for task_module in worker.js pyodide/pyodide.mjs pyodide/pyodide.asm.mjs; do
      task_headers="$(docker exec d500-web wget -S --spider "http://127.0.0.1:8080/radio/$task_module" 2>&1)"
      if ! [[ "$task_headers" =~ Content-Type:\ (application|text)/javascript ]]; then
        echo "Invalid radio module MIME: $task_module" >&2
        exit 1
      fi
    done
    exit 0
  fi
  sleep 1
done
echo 'Health check failed; the previous release remains available for rollback.' >&2
exit 1
REMOTE
if [ -n "${D500_PUBLIC_URL:-}" ]; then
  NODE_USE_ENV_PROXY=1 node scripts/verify-radio-assets.mjs "$D500_PUBLIC_URL"
fi
echo "Deployed $task_release. Verify /version.json on your configured HTTPS host."
