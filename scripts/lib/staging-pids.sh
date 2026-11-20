#!/usr/bin/env bash
# staging-pids.sh — pick the staging server PIDs out of a `ps` snapshot.
#
# WHY THIS EXISTS (2026-11-20): the deploy script's restart step used to filter
# pgrep -f candidates with `ps -o comm= -p $p  == node`. Node 24 reports
# comm=MainThread, so the filter matched nothing, OLD stayed empty, no process
# was stopped, and the health gate passed against the PREVIOUS instance — a
# silent no-op restart that happily reported success.
#
# Selection is therefore argument-based, never comm-based:
#   * the process must carry the launcher path as one of its argv tokens, and
#   * argv[0] must be a Node binary (`node` or an absolute path ending in
#     `/node`), which excludes the invoking shell/ssh session whose own cmdline
#     necessarily contains the launcher path, and
#   * the calling shell and its whole ancestor chain are excluded outright.
#
# Usage (snapshot on stdin, one PID per line on stdout, ascending):
#   ps -eo pid=,ppid=,comm=,args= | staging_select_pids <self-pid> <launcher-path>
#
# Reads: pid, ppid, comm, args (args = remainder of the line).
# comm is read but NEVER used for matching — it is only carried along so the
# snapshot shape is the same on any Node/kernel combination.

staging_select_pids() {
  local self_pid="${1:-}"
  local launcher="${2:-}"
  local line pid ppid comm args
  local -a pids=() ppids=() argses=()
  local -A excluded=()
  local i cur

  while IFS= read -r line; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    read -r pid ppid comm args <<<"$line"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    pids+=("$pid")
    ppids+=("$ppid")
    argses+=("${args:-}")
  done

  # Self + ancestor chain, resolved from the same snapshot (pid -> ppid).
  cur="$self_pid"
  local hops=0
  while [[ "$cur" =~ ^[0-9]+$ ]] && (( cur > 0 )) && (( hops < 64 )); do
    excluded["$cur"]=1
    local next=""
    for i in "${!pids[@]}"; do
      if [[ "${pids[$i]}" == "$cur" ]]; then next="${ppids[$i]}"; break; fi
    done
    [[ -z "$next" ]] && break
    cur="$next"
    hops=$((hops + 1))
  done

  local argv0 tok
  for i in "${!pids[@]}"; do
    pid="${pids[$i]}"
    [[ -n "${excluded[$pid]:-}" ]] && continue
    local cmdline="${argses[$i]}"
    [[ -z "$launcher" || -z "$cmdline" ]] && continue
    # Launcher path must appear as a whitespace-delimited argv token.
    local found=0
    # shellcheck disable=SC2086
    for tok in $cmdline; do
      if [[ "$tok" == "$launcher" ]]; then found=1; break; fi
    done
    (( found == 1 )) || continue
    read -r argv0 _ <<<"$cmdline"
    [[ -z "$argv0" ]] && continue
    # argv[0] must be a node binary — this is what keeps the invoking shell
    # (whose cmdline embeds the launcher path) out of the candidate set.
    if [[ "$(basename "$argv0")" != "node" && "$(basename "$argv0")" != "nodejs" ]]; then
      continue
    fi
    printf '%s\n' "$pid"
  done | sort -n
}
