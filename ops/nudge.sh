#!/usr/bin/env bash
# Interactive agents stop when they finish a turn. This loop checks every agent's tmux
# pane once a minute; when a pane hasn't changed for its idle limit, it types the next
# instruction into it. Working agents keep printing, so they are left alone.
#
# Tune with env vars: LEAD_IDLE (default 600 s), IMPL_IDLE (default 300 s).
LEAD_IDLE=${LEAD_IDLE:-600}
IMPL_IDLE=${IMPL_IDLE:-300}
declare -A last_hash last_change

nudge_text() {
  case "$1" in
    orchestrator) echo "Run the next orchestrator cycle now (AGENTS.md section 3): agentorch board unread, agentorch ticket list --all, gh pr list --state open. Act, post [STATUS] if anything changed, then say CYCLE DONE." ;;
    *) echo "Continue the implementer loop (AGENTS.md section 2): agentorch board unread, then agentorch ticket next. If you are mid-ticket, finish it first. If nothing is ready, post [IDLE] once and say IDLE." ;;
  esac
}

while true; do
  now=$(date +%s)
  for s in orchestrator agent-1 agent-2; do
    tmux has-session -t "$s" 2>/dev/null || continue
    hash=$(tmux capture-pane -p -t "$s" -S -60 | md5sum | cut -d' ' -f1)
    if [ "${last_hash[$s]:-}" != "$hash" ]; then
      last_hash[$s]=$hash; last_change[$s]=$now; continue
    fi
    limit=$IMPL_IDLE; [ "$s" = orchestrator ] && limit=$LEAD_IDLE
    if [ $((now - ${last_change[$s]:-$now})) -ge "$limit" ]; then
      echo "$(date '+%H:%M') nudging $s"
      tmux send-keys -t "$s" -l "$(nudge_text "$s")"; tmux send-keys -t "$s" Enter
      last_change[$s]=$now
    fi
  done
  sleep 60
done
