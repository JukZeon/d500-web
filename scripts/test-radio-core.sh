#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p .deploy/chirp-test-fixtures
python3 -m venv .deploy/radio-core-test-env
.deploy/radio-core-test-env/bin/python - <<'PY'
import json, pathlib, urllib.request, hashlib
lock=json.loads(pathlib.Path('radio-core/vendor/UPSTREAM.json').read_text())
for name,sha in lock['fixtures'].items():
 path=pathlib.Path('.deploy/chirp-test-fixtures')/name
 if not path.exists():
  with urllib.request.urlopen('https://raw.githubusercontent.com/kk7ds/chirp/'+lock['revision']+'/tests/images/'+name) as response:path.write_bytes(response.read())
 if hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise SystemExit('Fixture hash mismatch: '+name)
PY
CHIRP_FIXTURES=.deploy/chirp-test-fixtures .deploy/radio-core-test-env/bin/python -m unittest discover -s radio-core
