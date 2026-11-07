#!/bin/bash
# End to end: a headless Claude Code agent edits the fixture site with Understudy's Stop
# hook installed. Usage: UNDERSTUDY_HOME=<data folder> tools/e2e.sh <scratch folder>
set -e
HOME_DIR=${UNDERSTUDY_HOME:?set UNDERSTUDY_HOME}; WORK=${1:?scratch folder}; ROOT=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$WORK/northwind"; mkdir -p "$WORK/northwind"; cp "$ROOT"/test/fixtures/site/* "$WORK/northwind/"; cd "$WORK/northwind"
git init -q; echo '{ "url": "http://127.0.0.1:4740/", "project": "northwind" }' > .understudy.json
git add -A; git -c user.email=e2e@local -c user.name=e2e commit -qm "Northwind landing page"
python3 -m http.server 4740 --bind 127.0.0.1 >/dev/null 2>&1 & SERVER=$!; trap "kill $SERVER" EXIT; sleep 1
HOOK="UNDERSTUDY_HOME=$HOME_DIR PATH=$(dirname "$(command -v node)"):\$PATH understudy hook"
claude -p "This is our studio's landing page (index.html and style.css). Add a one-line note under the hero saying we're based in Chicago, and keep the page looking good." \
  --model claude-sonnet-5 --permission-mode acceptEdits --allowedTools "Read Edit Write Glob Grep" --strict-mcp-config --setting-sources "" \
  --settings "{\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"$HOOK\",\"timeout\":600}]}]}}" --output-format json \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('turns',d.get('num_turns'),'cost',round(d.get('total_cost_usd',0),3));print(d.get('result'))"
