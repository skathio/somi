#!/usr/bin/env bash
# somi-findings.sh — the findings ledger: identity and lifecycle for review findings.
#
# Review findings used to live only as prose in per-review markdown files. The
# loop circuit breakers matched recurrences from conversation memory (lost on
# session death), and a re-review had no way to assert "is F-3 fixed?" — it
# rediscovered everything. This ledger gives each finding a stable ID and a
# status, computed mechanically on a stable locus (file + symbol + normalized
# title), so:
#   - /code-loop's circuit breaker fires on a CONSECUTIVE-pass recurrence,
#   - /ship-loop's cross-layer breaker fires on a CROSS-RUN recurrence,
#   - /review starts by re-checking open findings instead of starting blind,
#   - progress.md follow-ups can reference F-<n> instead of prose.
#
# Ledger: .somi/reviews/<slug>/findings.json — committed with the other review
# artifacts (it is the machine view; the markdown review file stays the human
# view; the same command writes both in the same step).
#
# Subcommands:
#   record  --slug S [--review FILE] [--run ID] [--pass N]
#           stdin: JSON array [{file, symbol, title, severity, confidence}, …]
#           Upserts each finding: new locus → new F-<n>; known OPEN locus →
#           appends a sighting. Prints one JSON line per finding with
#           {id, state: "new"|"known", recurring_consecutive, recurring_cross_run}.
#           Exit 5 if ANY finding is recurring_consecutive (the in-loop circuit
#           breaker signal) — the caller decides what to do with it.
#   resolve --slug S --id F-3 --status fixed|accepted|wontfix [--by REVIEW]
#   reopen  --slug S --id F-3 [--by REVIEW]
#   open    --slug S            → JSON array of open findings
#   get     --slug S --id F-3   → one finding
#
# Locus matching: same file + same symbol (case-insensitive) + same normalized
# title (lowercased, non-alphanumerics collapsed, first 8 words). Line numbers
# are deliberately NOT part of the locus — lines drift between passes.
#
# Exit codes: 0 ok · 5 consecutive recurrence detected (record only) · 64 error.
# Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

set -euo pipefail

die() { echo "somi-findings: $*" >&2; exit 64; }
command -v jq >/dev/null 2>&1 || die "requires jq"

project_root() {
  local b="${CLAUDE_PROJECT_DIR:-$PWD}"
  [[ "$b" == *'${'* ]] && b="$PWD"
  printf '%s' "$b"
}

CMD="${1:-}"; shift || true
SLUG="" REVIEW="" RUN="" PASS=0 ID="" STATUS="" BY=""
while (( $# > 0 )); do
  case "$1" in
    --slug)   SLUG="$2"; shift 2 ;;
    --review) REVIEW="$2"; shift 2 ;;
    --run)    RUN="$2"; shift 2 ;;
    --pass)   PASS="$2"; shift 2 ;;
    --id)     ID="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --by)     BY="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$CMD" ]]  || die "usage: somi-findings.sh <record|resolve|reopen|open|get> --slug <slug> …"
[[ -n "$SLUG" ]] || die "--slug is required"

LEDGER_DIR="$(project_root)/.somi/reviews/$SLUG"
LEDGER="$LEDGER_DIR/findings.json"

ensure_ledger() {
  mkdir -p "$LEDGER_DIR"
  [[ -f "$LEDGER" ]] || printf '{"next_id": 1, "findings": []}\n' > "$LEDGER"
}

normalize_title() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cs 'a-z0-9' ' ' \
    | awk '{ for (i = 1; i <= NF && i <= 8; i++) printf "%s%s", (i > 1 ? " " : ""), $i }'
}

case "$CMD" in
  record)
    ensure_ledger
    input="$(cat)"
    count="$(jq 'length' <<<"$input")" || die "stdin must be a JSON array of findings"
    now="$(date -u +%Y-%m-%d)"
    breaker=0
    for ((i = 0; i < count; i++)); do
      f="$(jq -c ".[$i]" <<<"$input")"
      file="$(jq -r '.file // empty' <<<"$f")"
      symbol="$(jq -r '.symbol // ""' <<<"$f" | tr '[:upper:]' '[:lower:]')"
      title="$(jq -r '.title // empty' <<<"$f")"
      [[ -n "$file" && -n "$title" ]] || die "finding $i needs at least {file, title}"
      key="${file}|${symbol}|$(normalize_title "$title")"

      existing="$(jq -r --arg k "$key" \
        '[.findings[] | select(.key == $k and .status == "open")][0].id // empty' "$LEDGER")"

      if [[ -n "$existing" ]]; then
        # Known open finding: recurrence classification BEFORE appending the sighting.
        recurring_consecutive="$(jq -r --arg id "$existing" --arg run "$RUN" --argjson p "$PASS" \
          '[.findings[] | select(.id == $id) | .seen[]
            | select(.run == $run and .pass == ($p - 1))] | length > 0' "$LEDGER")"
        recurring_cross="$(jq -r --arg id "$existing" --arg run "$RUN" \
          '[.findings[] | select(.id == $id) | .seen[] | select(.run != $run)] | length > 0' "$LEDGER")"
        tmp="$(mktemp)"
        jq --arg id "$existing" --arg rev "$REVIEW" --arg run "$RUN" \
           --argjson p "$PASS" --arg d "$now" \
           '(.findings[] | select(.id == $id) | .seen) += [{review: $rev, run: $run, pass: $p, date: $d}]' \
           "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
        [[ "$recurring_consecutive" == "true" ]] && breaker=1
        jq -nc --arg id "$existing" --argjson rc "$recurring_consecutive" --argjson rx "$recurring_cross" \
          '{id: $id, state: "known", recurring_consecutive: $rc, recurring_cross_run: $rx}'
      else
        new_id="F-$(jq -r '.next_id' "$LEDGER")"
        tmp="$(mktemp)"
        jq --arg id "$new_id" --arg key "$key" --argjson f "$f" \
           --arg rev "$REVIEW" --arg run "$RUN" --argjson p "$PASS" --arg d "$now" \
           '.next_id += 1
            | .findings += [{
                id: $id, key: $key,
                locus: {file: $f.file, symbol: ($f.symbol // "")},
                title: $f.title,
                severity: ($f.severity // "Minor"),
                confidence: ($f.confidence // "Medium"),
                status: "open",
                introduced_by: $rev, resolved_by: null,
                seen: [{review: $rev, run: $run, pass: $p, date: $d}]
              }]' "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
        jq -nc --arg id "$new_id" \
          '{id: $id, state: "new", recurring_consecutive: false, recurring_cross_run: false}'
      fi
    done
    (( breaker )) && exit 5
    exit 0
    ;;

  resolve)
    ensure_ledger
    [[ -n "$ID" && -n "$STATUS" ]] || die "resolve requires --id and --status"
    case "$STATUS" in fixed|accepted|wontfix) ;; *) die "--status must be fixed|accepted|wontfix" ;; esac
    tmp="$(mktemp)"
    jq --arg id "$ID" --arg s "$STATUS" --arg by "$BY" \
       '(.findings[] | select(.id == $id)) |= (.status = $s | .resolved_by = $by)' \
       "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
    jq -c --arg id "$ID" '.findings[] | select(.id == $id) | {id, status, resolved_by}' "$LEDGER"
    ;;

  reopen)
    ensure_ledger
    [[ -n "$ID" ]] || die "reopen requires --id"
    tmp="$(mktemp)"
    jq --arg id "$ID" --arg by "$BY" \
       '(.findings[] | select(.id == $id)) |= (.status = "open" | .resolved_by = null | .reopened_by = $by)' \
       "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
    jq -c --arg id "$ID" '.findings[] | select(.id == $id) | {id, status}' "$LEDGER"
    ;;

  open)
    ensure_ledger
    jq '[.findings[] | select(.status == "open")
         | {id, locus, title, severity, confidence, introduced_by}]' "$LEDGER"
    ;;

  get)
    ensure_ledger
    [[ -n "$ID" ]] || die "get requires --id"
    jq --arg id "$ID" '.findings[] | select(.id == $id)' "$LEDGER"
    ;;

  *) die "unknown subcommand: $CMD" ;;
esac
