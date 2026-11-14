#!/usr/bin/env bash
# Set up the HackPrinceton agents on the Oracle server, wiping any earlier run.
#
#   orchestrator  Codex       ~/hackprinceton-orchestrator   @oracle-lead
#   agent-1       BanyanCode  ~/hackprinceton-agent-1        @oracle-1  (label samridh-claude)
#   agent-2       BanyanCode  ~/hackprinceton-agent-2        @oracle-2  (label samridh-claude)
#   nudger        bash loop   restarts any agent that has gone idle (ops/nudge.sh)
#
# Kept: ~/.config/agentorch (Linear key, GitHub App key, config), Hermes, Linear itself.
# Optional inputs, copied into every clone because git ignores them:
#   ~/.config/agentorch/hackprinceton.env.local   ->  .env.local
#   ~/hackprinceton-data/*                         ->  symlinked into the repo root
set -u
REPO=https://github.com/Samprab06/HackPrinceton.git
A=$HOME/.local/bin/agentorch
export PATH=$HOME/.local/bin:$PATH
fail() { echo "!! $*"; exit 1; }

echo "== preflight"
for tool in git gh tmux node codex banyancode "$A"; do
  command -v "$tool" >/dev/null || fail "$tool not found"
done
gh auth status >/dev/null 2>&1 || fail "gh is not logged in: run gh auth login, then gh auth setup-git"
codex login status >/dev/null 2>&1 || echo "!! codex may not be logged in: run codex login --device-auth"
if ! command -v pnpm >/dev/null; then
  echo "   installing pnpm"; npm install -g --prefix "$HOME/.local" pnpm >/dev/null 2>&1 || fail "could not install pnpm"
fi
[ -s "$HOME/.config/agentorch/linear-key" ] || fail "no Linear key at ~/.config/agentorch/linear-key"

echo "== stop old pieces"
systemctl --user disable --now agentorch-worker.service agentorch-supervise.timer agent-orchestrator.service 2>/dev/null
for s in orchestrator agent-1 agent-2 nudger lead banyan-1 banyan-2; do tmux kill-session -t "$s" 2>/dev/null; done

echo "== wipe old project state"
rm -rf ~/.local/share/agentorch/linear ~/.local/share/agentorch/repos ~/.local/state/agentorch \
       ~/hp-lead ~/hp-banyan-1 ~/hp-banyan-2 ~/HackPrinceton ~/.local/share/agent-orchestrator-worker \
       ~/hackprinceton-orchestrator ~/hackprinceton-agent-1 ~/hackprinceton-agent-2

echo "== agents the lead may assign to"
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path.home() / ".config/agentorch/config.json"; c = json.loads(p.read_text())
c.setdefault("planner", {})["extra_agents"] = ["samridh-claude", "frank-claude", "yasser-claude", "akshar-codex"]
c["planner"].pop("megadoc", None)
p.write_text(json.dumps(c, indent=2) + "\n")
EOF

echo "== clones"
for d in orchestrator agent-1 agent-2; do
  dir=$HOME/hackprinceton-$d
  git clone -q "$REPO" "$dir" || fail "clone failed (gh auth setup-git?)"
  # Strip AI attribution from every new commit made here.
  cat > "$dir/.git/hooks/commit-msg" <<'HOOK'
#!/bin/sh
sed -i -E '/^[Cc]o-[Aa]uthored-[Bb]y:.*([Cc]laude|[Aa]nthropic|[Oo]pen[Aa][Ii]|[Cc]odex|[Bb]anyan)/d; /[Gg]enerated (with|by) .*([Cc]laude|[Cc]odex|[Bb]anyan)/d; /^[Cc]laude-[Ss]ession:/d' "$1"
HOOK
  chmod +x "$dir/.git/hooks/commit-msg"
  [ -f "$HOME/.config/agentorch/hackprinceton.env.local" ] && install -m 600 "$HOME/.config/agentorch/hackprinceton.env.local" "$dir/.env.local"
  if [ -d "$HOME/hackprinceton-data" ]; then
    for item in "$HOME"/hackprinceton-data/*; do [ -e "$item" ] && ln -sfn "$item" "$dir/$(basename "$item")"; done
  fi
done

echo "== per-agent environments"
mk_env() { cat > "$HOME/.config/agentorch/session-$1.env" <<EOF
export PATH=\$HOME/.local/bin:\$PATH
export LINEAR_API_KEY=\$(cat \$HOME/.config/agentorch/linear-key)
export AGENTORCH_AGENT=$2
export AGENTORCH_SIGNATURE="$3"
export AGENTORCH_BOARD_CURSOR=$1
export AGENTORCH_HANDLES=$4
EOF
chmod 600 "$HOME/.config/agentorch/session-$1.env"; }
mk_env orchestrator oracle-lead    "Sam's Lead"     oracle-lead
mk_env agent-1      samridh-claude "Sam's Oracle 1" oracle-1
mk_env agent-2      samridh-claude "Sam's Oracle 2" oracle-2

LEAD="You are oracle-lead, the orchestrator. Read AGENTS.md, all of it. You own the project and the Linear tickets are the spec. Run the orchestrator cycle in AGENTS.md section 3 now. Start by posting a [STATUS] with the critical path. Posts signed [Sam's phone] are Sam's instructions relayed by Hermes: they come first. When a cycle is done, say CYCLE DONE and wait: you will be prompted for the next cycle."
impl() { echo "You are $1 (label samridh-claude), an implementer. Read AGENTS.md, all of it. Follow the implementer loop in section 2 until 'agentorch ticket next' has nothing for you, then post [IDLE] mentioning @oracle-lead and say IDLE. You will be prompted to continue."; }

echo "== start sessions"
tmux new -d -s orchestrator -c ~/hackprinceton-orchestrator \
  "source ~/.config/agentorch/session-orchestrator.env; codex --dangerously-bypass-approvals-and-sandbox \"$LEAD\"; exec bash"
tmux new -d -s agent-1 -c ~/hackprinceton-agent-1 "source ~/.config/agentorch/session-agent-1.env; banyancode; exec bash"
sleep 12; tmux send-keys -t agent-1 -l "$(impl oracle-1)"; tmux send-keys -t agent-1 Enter
sleep 45   # stagger the two Oracles so they don't claim the same ticket
tmux new -d -s agent-2 -c ~/hackprinceton-agent-2 "source ~/.config/agentorch/session-agent-2.env; banyancode; exec bash"
sleep 12; tmux send-keys -t agent-2 -l "$(impl oracle-2)"; tmux send-keys -t agent-2 Enter
tmux new -d -s nudger "bash ~/hackprinceton-orchestrator/ops/nudge.sh"

echo "== done"; tmux ls
echo "Watch: tmux attach -t orchestrator | agent-1 | agent-2 | nudger   (detach: Ctrl-b then d)"
