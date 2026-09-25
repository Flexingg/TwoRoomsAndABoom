#!/usr/bin/env bash
# Mutation 8, at the wire level: build a server whose viewFor() leaks every player's role, then run the
# independent raw-WebSocket check (tools/wire_leak_check.mjs) against it. The check MUST fail.
#
#   bash tools/wire_mutation_proof.sh
#
# Leaves the tree clean and rebuilds the honest server afterwards, so the deployed service can be restarted
# safely. Nothing here touches the systemd service.
set -u
cd "$(dirname "$0")/.."
PORT="${1:-8799}"
PY=python3
ANCHOR="    roaming: p.roaming,
  }));"
LEAK="    roaming: p.roaming,
    roleKey: sec.players[p.id]?.roleKey,
  } as RosterEntry));"

cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  git checkout -- shared/src/view.ts
  echo "== rebuilding the honest server"
  npm run build >/dev/null 2>&1
}
trap cleanup EXIT

echo "== applying the leak to shared/src/view.ts"
"$PY" - shared/src/view.ts "$ANCHOR" "$LEAK" <<'EOF'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
assert src.count(old) == 1, f"anchor appears {src.count(old)}x"
src = src.replace(old, new, 1)
src = src.replace("function roster(s: ServerGameState): RosterEntry[] {",
                  "function roster(s: ServerGameState): RosterEntry[] {\n  const sec = secretsOf(s);", 1)
open(path, "w").write(src)
EOF

echo "== rebuilding the leaking server"
npm run build >/dev/null 2>&1 || { echo "build failed"; exit 2; }

echo "== starting it on :$PORT"
node dist-server/index.js --port "$PORT" --host 127.0.0.1 >/tmp/leaking-server.log 2>&1 &
SRV=$!
for _ in $(seq 1 40); do grep -q listening /tmp/leaking-server.log && break; sleep 0.25; done

echo "== running the wire check against the leaking server (this MUST fail)"
node tools/wire_leak_check.mjs --port "$PORT"
RC=$?
echo
echo "wire check exit code: $RC"
if [ "$RC" -eq 0 ]; then
  echo "*** THE WIRE CHECK PASSED AGAINST A LEAKING SERVER — it is decorative ***"
  exit 1
fi
echo "caught: the wire check fails when viewFor leaks."
