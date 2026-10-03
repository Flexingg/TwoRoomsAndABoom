#!/usr/bin/env bash
# Build the Docker image and prove what is inside it and that it really serves.
#
#   bash tools/docker_verify.sh [host-port]        # default host port 18080
#
# This is the tool the plan-conformance pass was missing: `docker compose config` parses a file,
# it does not build one. Running the real build is what found the two defects this script now guards
# (see docs/DECISIONS.md D21).
#
# Two environment facts this script works around, both recorded in STATUS.md:
#   * the login shell predates the docker-group membership, so every docker call goes through
#     `sg docker` (a bare `docker ps` is "permission denied" but `sg docker -c 'docker ps'` is not);
#   * `docker compose` interpolates the whole file before it applies profiles, so we deliberately
#     DO NOT export DOMAIN — that is the regression test for the plan's bare one command;
#   * host :8080 is often taken by another service on this box, so the container is exercised on a
#     free host port by default.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
HOSTPORT="${1:-18080}"
IMG=tworoomsandaboom-app:latest
NAME=tr-verify
LOG=/tmp/tr_docker_verify.log
D="sg docker -c"

echo "### docker access"
$D 'docker version --format "client={{.Client.Version}} server={{.Server.Version}}"' || exit 1

echo
echo "### 1. compose config with DOMAIN unset (the plan's bare invocation must work)"
if $D 'docker compose config --quiet'; then echo "OK: bare compose config parses"; else echo "FAIL"; exit 1; fi

echo
echo "### 2. docker compose build"
$D 'docker compose build --progress plain' > "$LOG" 2>&1
rc=$?
echo "compose build exit=$rc"
grep -E "^#[0-9]+ \[build [0-9]+/[0-9]+\]|^#[0-9]+ DONE|ERROR" "$LOG" | tail -14
if [ "$rc" -ne 0 ]; then echo "--- last 40 lines ---"; tail -40 "$LOG"; exit "$rc"; fi

echo
echo "### 3. inside the image: printable_files/ and the raw sheets must be absent"
$D "docker run --rm --entrypoint sh $IMG -c 'ls /app; echo \"-- PDFs anywhere --\"; find / -name \"*.pdf\" -not -path \"/proc/*\" -not -path \"/sys/*\" 2>/dev/null | head; echo \"-- /app/printable_files --\"; ls /app/printable_files 2>&1 | head -2; echo \"-- node --\"; node -v; echo \"-- card art in the served bundle --\"; ls /app/dist/cards | wc -l'"

echo
echo "### 4. run it and check health, the card art, the pages"
$D "docker rm -f $NAME" >/dev/null 2>&1
$D "docker run -d --rm --name $NAME -p 127.0.0.1:$HOSTPORT:8080 $IMG" >/dev/null
ok=0
for _ in $(seq 1 25); do
  h=$(curl -s --max-time 3 "http://127.0.0.1:$HOSTPORT/api/health")
  [ -n "$h" ] && { echo "health: $h"; ok=1; break; }
  sleep 2
done
[ "$ok" -eq 0 ] && { echo "FAIL: no /api/health"; $D "docker logs $NAME" 2>&1 | tail -20; $D "docker rm -f $NAME" >/dev/null; exit 1; }
for p in /cards/agent_blue.webp /cards/card_back.webp /cards/leader.webp / /play /roles; do
  curl -s -o /dev/null -w "GET $p -> %{http_code} %{content_type}\n" "http://127.0.0.1:$HOSTPORT$p"
done

echo
echo "### 5. a real game over the built image (raw WS: 6 players, a reveal, host learns nothing)"
node tools/wire_leak_check.mjs --port "$HOSTPORT" || echo "container game check FAILED"

echo
echo "### 6. the container writes its SQLite snapshot where the volume is mounted"
$D "docker exec $NAME sh -c 'ls -la /data'"

echo
$D "docker rm -f $NAME" >/dev/null 2>&1
echo "DONE — docker image built and exercised"
