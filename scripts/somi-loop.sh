#!/usr/bin/env bash
# somi-loop.sh — deterministic state engine for the bounded loops.
#
# The loop commands (/code-loop, /plan-loop, /ship-loop, /code-parallel) used to
# ask the orchestrating model to simulate a state machine in conversation
# context: count passes, parse `git diff --shortstat`, remember a baseline SHA,
# and compare findings across passes. Models miscount and sessions die; the
# caps are SoMi's central safety claim, so their arithmetic lives here instead.
# The model keeps the judgment (what to do when a gate fires); this script owns
# the counting, and the state survives session death — a loop can RESUME.
#
# State: .claude/somi-state/loop/<slug>[.<iteration>].json under the project
# root (project-local, gitignored by SoMi's conventions). Never committed.
#
# Cap precedence (matches the gate tables): CLI flag > env var > .somi/config.json
# > default. Diff measurement EXCLUDES .somi/ and .claude/ — artifact churn
# (progress/diary updates every pass) must not eat the code diff budget.
#
# Exit codes (callers branch on these — do not repurpose):
#   0  ok
#   2  max-passes-exceeded   (`pass` would exceed the cap)
#   3  diff-cap-exceeded     (`check-diff`: weighted lines over the cap;
#                             out-of-scope lines count double)
#   64 usage / environment error
#
# Subcommands:
#   init   --slug S --loop code|plan [--iteration N.M] [--files "p1 p2 …"]
#          [--max-passes N] [--diff-cap N] [--severity-floor Sev]
#          Captures BASELINE_SHA once, resolves caps, writes fresh state.
#          Refuses to clobber a still-running state unless --force.
#   resume --slug S [--iteration N.M]
#          Prints existing state (exit 64 if none) — session-death recovery.
#   pass   --slug S [--iteration N.M]
#          Increments the pass counter; exit 2 when it would exceed max_passes.
#   check-diff --slug S [--iteration N.M]
#          Cumulative diff vs the recorded baseline (committed + working tree,
#          .somi/.claude excluded). Out-of-scope files (not in the iteration
#          file list) count DOUBLE. Prints JSON; exit 3 when over the cap.
#   record-pass --slug S [--iteration N.M] --verdict V [--blockers N] [--majors N]
#          Appends a history entry (with current diff size) for telemetry.
#   finish --slug S [--iteration N.M] --status done|stopped-<reason>
#   stats  --slug S [--iteration N.M]
#          Prints the state JSON (passes used, history, caps — the run ledger).
#
# Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

set -euo pipefail

die() { echo "somi-loop: $*" >&2; exit 64; }
command -v jq >/dev/null 2>&1 || die "requires jq"
command -v git >/dev/null 2>&1 || die "requires git"

project_root() {
  local b="${CLAUDE_PROJECT_DIR:-$PWD}"
  [[ "$b" == *'${'* ]] && b="$PWD"
  printf '%s' "$b"
}

config_val() { # $1 = jq path into .somi/config.json
  local cfg
  cfg="$(project_root)/.somi/config.json"
  [[ -f "$cfg" ]] || return 0
  jq -r "$1 // empty" "$cfg" 2>/dev/null || true
}

STATE_DIR="${SOMI_LOOP_STATE_DIR:-$(project_root)/.claude/somi-state/loop}"

# --- argument parsing (shared) -----------------------------------------------
CMD="${1:-}"; shift || true
SLUG="" LOOP="code" ITERATION="" FILES="" VERDICT="" BLOCKERS=0 MAJORS=0
STATUS="" FORCE=0
ARG_MAX_PASSES="" ARG_DIFF_CAP="" ARG_SEVERITY=""
while (( $# > 0 )); do
  case "$1" in
    --slug)           SLUG="$2"; shift 2 ;;
    --loop)           LOOP="$2"; shift 2 ;;
    --iteration)      ITERATION="$2"; shift 2 ;;
    --files)          FILES="$2"; shift 2 ;;
    --max-passes)     ARG_MAX_PASSES="$2"; shift 2 ;;
    --diff-cap)       ARG_DIFF_CAP="$2"; shift 2 ;;
    --severity-floor) ARG_SEVERITY="$2"; shift 2 ;;
    --verdict)        VERDICT="$2"; shift 2 ;;
    --blockers)       BLOCKERS="$2"; shift 2 ;;
    --majors)         MAJORS="$2"; shift 2 ;;
    --status)         STATUS="$2"; shift 2 ;;
    --force)          FORCE=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$CMD" ]]  || die "usage: somi-loop.sh <init|resume|pass|check-diff|record-pass|finish|stats> --slug <slug> …"
[[ -n "$SLUG" ]] || die "--slug is required"

state_file() {
  local name="$SLUG"
  [[ -n "$ITERATION" ]] && name="$SLUG.$ITERATION"
  printf '%s/%s.json' "$STATE_DIR" "$name"
}
SF="$(state_file)"

require_state() { [[ -f "$SF" ]] || die "no loop state at $SF — run init first"; }

# Weighted cumulative diff vs baseline. Out-of-scope lines count double.
compute_diff() { # prints: total_lines <TAB> weighted_lines <TAB> out_of_scope (space-joined)
  local base files_json root
  base="$(jq -r '.baseline_sha' "$SF")"
  files_json="$(jq -c '.iteration_files' "$SF")"
  root="$(project_root)"
  local total=0 weighted=0 oos=""
  local added deleted file lines in_scope entry
  while IFS=$'\t' read -r added deleted file; do
    [[ -z "$file" ]] && continue
    [[ "$added" == "-" ]] && added=0     # binary
    [[ "$deleted" == "-" ]] && deleted=0
    lines=$((added + deleted))
    total=$((total + lines))
    in_scope=0
    while IFS= read -r entry; do
      [[ -z "$entry" ]] && continue
      if [[ "$file" == "$entry" || ( "$entry" == */ && "$file" == "$entry"* ) ]]; then
        in_scope=1; break
      fi
    done < <(jq -r '.[]?' <<<"$files_json")
    if (( in_scope )); then
      weighted=$((weighted + lines))
    else
      weighted=$((weighted + 2 * lines))
      oos+="${oos:+ }$file"
    fi
  done < <(git -C "$root" diff --numstat "$base" -- . ':(exclude).somi' ':(exclude).claude' 2>/dev/null)
  # Trailing newline matters: `read` under `set -e` fails on EOF without one.
  printf '%s\t%s\t%s\n' "$total" "$weighted" "$oos"
}

case "$CMD" in
  init)
    mkdir -p "$STATE_DIR"
    if [[ -f "$SF" && $FORCE -eq 0 ]] && [[ "$(jq -r '.status' "$SF")" == "running" ]]; then
      die "loop state already running at $SF — use 'resume' to continue it, or 'init --force' to discard"
    fi
    # Cap resolution: CLI > env > config > default (per loop type).
    local_max="" local_cap="" local_sev=""
    if [[ "$LOOP" == "plan" ]]; then
      local_max="${ARG_MAX_PASSES:-${SOMI_PLAN_LOOP_MAX_PASSES:-$(config_val '.plan_loop.max_passes')}}"
      local_sev="${ARG_SEVERITY:-${SOMI_PLAN_LOOP_SEVERITY_FLOOR:-$(config_val '.plan_loop.severity_floor')}}"
      local_cap="0"   # plan loops have no diff cap
    else
      local_max="${ARG_MAX_PASSES:-${SOMI_CODE_LOOP_MAX_PASSES:-$(config_val '.code_loop.max_passes')}}"
      local_sev="${ARG_SEVERITY:-${SOMI_CODE_LOOP_SEVERITY_FLOOR:-$(config_val '.code_loop.severity_floor')}}"
      local_cap="${ARG_DIFF_CAP:-${SOMI_CODE_LOOP_DIFF_CAP:-$(config_val '.code_loop.diff_cap_lines')}}"
    fi
    local_max="${local_max:-3}"; local_sev="${local_sev:-Major}"; local_cap="${local_cap:-400}"
    baseline="$(git -C "$(project_root)" rev-parse HEAD)" || die "cannot resolve HEAD"
    # printf with trailing newline: jq -R needs one line even when --files is empty.
    files_json="$(printf '%s\n' "$FILES" | jq -R 'split(" ") | map(select(length > 0))')"
    jq -n \
      --arg slug "$SLUG" --arg loop "$LOOP" --arg iteration "$ITERATION" \
      --arg baseline "$baseline" --arg started "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --argjson max "$local_max" --argjson cap "$local_cap" --arg sev "$local_sev" \
      --argjson files "$files_json" \
      '{slug: $slug, loop: $loop, iteration: $iteration,
        baseline_sha: $baseline, started: $started, status: "running",
        caps: {max_passes: $max, diff_cap_lines: $cap, severity_floor: $sev},
        iteration_files: $files, pass: 0, history: []}' > "$SF"
    jq -c '{baseline_sha, caps, state_file: input_filename}' "$SF"
    ;;

  resume)
    require_state
    jq -c . "$SF"
    ;;

  pass)
    require_state
    max="$(jq -r '.caps.max_passes' "$SF")"
    cur="$(jq -r '.pass' "$SF")"
    if (( cur + 1 > max )); then
      echo "max-passes-exceeded: pass $((cur + 1)) > cap $max" >&2
      exit 2
    fi
    tmp="$(mktemp)"; jq '.pass += 1' "$SF" > "$tmp" && mv "$tmp" "$SF"
    jq -c '{pass, max_passes: .caps.max_passes}' "$SF"
    ;;

  check-diff)
    require_state
    IFS=$'\t' read -r total weighted oos < <(compute_diff)
    cap="$(jq -r '.caps.diff_cap_lines' "$SF")"
    oos_json="$(printf '%s\n' "$oos" | jq -R 'split(" ") | map(select(length > 0))')"
    jq -nc --argjson total "$total" --argjson weighted "$weighted" \
      --argjson cap "$cap" --argjson oos "$oos_json" \
      '{diff_lines: $total, weighted_lines: $weighted, cap: $cap, out_of_scope: $oos}'
    if (( cap > 0 && weighted > cap )); then
      echo "diff-cap-exceeded: weighted $weighted > cap $cap (out-of-scope counts double)" >&2
      exit 3
    fi
    ;;

  record-pass)
    require_state
    [[ -n "$VERDICT" ]] || die "record-pass requires --verdict"
    IFS=$'\t' read -r total _ _ < <(compute_diff)
    tmp="$(mktemp)"
    jq --arg v "$VERDICT" --argjson b "$BLOCKERS" --argjson m "$MAJORS" \
       --argjson lines "$total" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       '.history += [{pass: .pass, verdict: $v, blockers: $b, majors: $m, diff_lines: $lines, at: $at}]' \
       "$SF" > "$tmp" && mv "$tmp" "$SF"
    jq -c '.history[-1]' "$SF"
    ;;

  finish)
    require_state
    [[ -n "$STATUS" ]] || die "finish requires --status"
    tmp="$(mktemp)"
    jq --arg s "$STATUS" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       '.status = $s | .finished = $at' "$SF" > "$tmp" && mv "$tmp" "$SF"
    jq -c '{status, pass, history: (.history | length)}' "$SF"
    ;;

  stats)
    require_state
    jq . "$SF"
    ;;

  *) die "unknown subcommand: $CMD" ;;
esac
