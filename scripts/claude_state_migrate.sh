#!/usr/bin/env bash
#
# Move this repository's local Claude Code state to another machine or account.
#
# WHY THIS EXISTS
# ---------------
# "Copy my Claude account into a different one" is two problems wearing one coat,
# and only one of them is solvable:
#
#   PORTABLE — plain files on disk, owned by nobody. Session transcripts, project
#              memory, user-level CLAUDE.md, skills and agents. Copy them and the
#              new account resumes mid-thought, because `claude --resume` reads
#              them off the filesystem and never asks the server who you are.
#
#   NOT PORTABLE — server-side, bound to the account that created it. claude.ai
#              conversations, Claude Code on the web sessions, Routines, Artifacts,
#              the GitHub App connection. There is an export path for chats
#              (Settings -> Privacy -> Export data) and no import path anywhere.
#              A second account cannot inherit them. Plan to reconnect, not migrate.
#
# The trap in the portable half is the directory key. Claude Code files sessions
# under ~/.claude/projects/<absolute-cwd-with-every-non-alphanumeric-turned-into-a-dash>.
# So /Users/you/Projects/restaurant-ai-automation becomes
# -Users-you-Projects-restaurant-ai-automation. Clone to a different path on the
# new machine and `--resume` shows an empty list next to 300MB of intact history,
# because it looked under a key that does not exist. This script computes both
# keys and rewrites the transcripts when they differ.
#
# CREDENTIALS ARE NEVER BUNDLED. Not as a default, not behind a flag. Copying
# ~/.claude/.credentials.json (or the macOS Keychain item "Claude Code-credentials")
# would authenticate the new machine as the OLD account, which is the exact
# opposite of moving out. The new account runs `claude login` once and owns its
# own token.
#
# USAGE
#   scripts/claude_state_migrate.sh list    [--repo PATH]
#   scripts/claude_state_migrate.sh export  [--repo PATH] [--out DIR] [--since N] [--with-user-config]
#   scripts/claude_state_migrate.sh inspect BUNDLE
#   scripts/claude_state_migrate.sh import  BUNDLE [--repo PATH] [--dry-run] [--no-rewrite]
#   scripts/claude_state_migrate.sh verify  [--repo PATH]
#
# Run `list` and `verify` on both sides. They are the evidence that the move worked.
#
# WHAT VERIFY ACCEPTS
# It reads the last cwd each transcript records, and sessions move: one opened at the
# root and left in apps/web records apps/web. So a cwd passes when it is the repo or a
# path under it, compared on path boundaries (restaurant-ai-automation-other is outside).
# A cwd outside the repo fails, exit 1, every such session named and tagged with whether
# that path exists here; a transcript import never rewrote looks like that. A cwd inside
# the repo whose directory is gone (a removed worktree, or one a fresh clone never had)
# only warns. Cases: scripts/test_claude_state_verify.py, ADR 0148 verification record.

set -euo pipefail

CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PROJECTS_DIR="$CLAUDE_HOME/projects"

# Files that must never leave the source machine, matched by basename anywhere
# in the tree. Extend this list, never trim it.
readonly SECRET_BASENAMES=(
  ".credentials.json"
  "credentials.json"
  ".env"
  ".env.local"
  "id_rsa"
  "id_ed25519"
  ".netrc"
)

die() { printf '❌ %s\n' "$*" >&2; exit 1; }
info() { printf '   %s\n' "$*"; }

# Claude Code's project-directory key: every character outside [A-Za-z0-9-]
# becomes a dash. Verified against two live keys —
#   /home/user/RestaurantAIAutomation            -> -home-user-RestaurantAIAutomation
#   /Users/x/Projects/restaurant-ai-automation   -> -Users-x-Projects-restaurant-ai-automation
key_for_path() {
  printf '%s' "$1" | sed 's/[^A-Za-z0-9-]/-/g'
}

# Absolute, symlink-resolved path of the repo we are moving.
resolve_repo() {
  local p="${1:-}"
  if [[ -z "$p" ]]; then
    p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  fi
  [[ -d "$p" ]] || die "Not a directory: $p"
  (cd "$p" && pwd -P)
}

python_helper() {
  python3 "$(dirname "${BASH_SOURCE[0]}")/_claude_state.py" "$@"
}

# ---------------------------------------------------------------- list

cmd_list() {
  local repo; repo="$(resolve_repo "${REPO_ARG:-}")"
  local key; key="$(key_for_path "$repo")"
  local dir="$PROJECTS_DIR/$key"

  printf '📂 repo   %s\n' "$repo"
  printf '🔑 key    %s\n' "$key"
  printf '📁 store  %s\n' "$dir"
  echo

  [[ -d "$dir" ]] || die "No session store for this path. Either Claude Code never ran here, or the repo moved (see \`verify\`)."
  python_helper list "$dir"
}

# ---------------------------------------------------------------- export

cmd_export() {
  local repo; repo="$(resolve_repo "${REPO_ARG:-}")"
  local key; key="$(key_for_path "$repo")"
  local src="$PROJECTS_DIR/$key"
  local out="${OUT_ARG:-$PWD}"
  local stamp; stamp="$(date +%Y%m%d_%H%M%S)"
  local stage; stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN

  [[ -d "$src" ]] || die "No session store at $src — nothing to export. Run \`list\` to see what key this path resolves to."
  mkdir -p "$out"

  local bundle="$out/claude-state_${key}_${stamp}.tar.gz"
  local payload="$stage/claude-state"
  mkdir -p "$payload/projects/$key"

  info "Collecting sessions from $src"
  if [[ -n "${SINCE_ARG:-}" ]]; then
    python_helper select "$src" "$SINCE_ARG" | while IFS= read -r f; do
      cp -a "$f" "$payload/projects/$key/"
    done
    info "Kept the $SINCE_ARG most recent session(s)"
  else
    # Copy the whole store, then strip anything on the blocklist.
    cp -a "$src/." "$payload/projects/$key/"
  fi

  # Per-session sidecar directories and project memory ride along with the
  # transcripts; --since only filters the .jsonl files themselves.
  if [[ -n "${SINCE_ARG:-}" && -d "$src/memory" ]]; then
    cp -a "$src/memory" "$payload/projects/$key/"
  fi

  if [[ "${WITH_USER_CONFIG:-0}" == "1" ]]; then
    mkdir -p "$payload/user"
    for item in CLAUDE.md settings.json keybindings.json skills agents commands; do
      [[ -e "$CLAUDE_HOME/$item" ]] && cp -a "$CLAUDE_HOME/$item" "$payload/user/" && info "Included user-level $item"
    done
  fi

  # Hard credential sweep. Runs unconditionally, after everything is staged.
  local purged=0
  for name in "${SECRET_BASENAMES[@]}"; do
    while IFS= read -r -d '' hit; do
      rm -rf "$hit"; purged=$((purged + 1))
      info "Purged credential file from bundle: ${hit#"$payload"/}"
    done < <(find "$payload" -name "$name" -print0 2>/dev/null)
  done

  python_helper manifest "$payload" "$repo" "$key" > "$payload/manifest.json"

  tar -czf "$bundle" -C "$stage" claude-state

  echo
  printf '✅ Bundle written\n'
  printf '   %s\n' "$bundle"
  printf '   %s\n' "$(du -h "$bundle" | cut -f1) — $(find "$payload/projects/$key" -maxdepth 1 -name '*.jsonl' | wc -l | tr -d ' ') session transcript(s), $purged credential file(s) purged"
  echo
  info "Next: copy it to the new machine, then run"
  info "  scripts/claude_state_migrate.sh inspect <bundle>"
  info "  scripts/claude_state_migrate.sh import  <bundle> --repo /path/to/new/clone"
}

# ---------------------------------------------------------------- inspect

cmd_inspect() {
  local bundle="${1:?bundle path required}"
  [[ -f "$bundle" ]] || die "No such bundle: $bundle"
  local stage; stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN

  tar -xzf "$bundle" -C "$stage"
  local payload="$stage/claude-state"
  [[ -d "$payload" ]] || die "Bundle does not contain a claude-state/ root — is it one of ours?"

  python_helper inspect "$payload"

  echo
  local found=0
  for name in "${SECRET_BASENAMES[@]}"; do
    while IFS= read -r -d '' hit; do
      printf '🚨 credential file present in bundle: %s\n' "${hit#"$payload"/}"; found=1
    done < <(find "$payload" -name "$name" -print0 2>/dev/null)
  done
  [[ $found -eq 0 ]] && printf '🔒 No credential files in bundle.\n'

  printf '🔎 Scanning transcripts for pasted secrets (counts only, never values)\n'
  python_helper scan "$payload"
}

# ---------------------------------------------------------------- import

cmd_import() {
  local bundle="${1:?bundle path required}"
  [[ -f "$bundle" ]] || die "No such bundle: $bundle"
  local repo; repo="$(resolve_repo "${REPO_ARG:-}")"
  local dest_key; dest_key="$(key_for_path "$repo")"
  local stage; stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN

  tar -xzf "$bundle" -C "$stage"
  local payload="$stage/claude-state"
  [[ -d "$payload/projects" ]] || die "Bundle has no projects/ payload."

  local src_key; src_key="$(basename "$(find "$payload/projects" -mindepth 1 -maxdepth 1 -type d | head -1)")"
  [[ -n "$src_key" ]] || die "Bundle has no project store inside projects/."
  local src_repo; src_repo="$(python_helper manifest-field "$payload/manifest.json" source_repo)"

  printf '📦 bundle      %s\n' "$bundle"
  printf '📂 source repo %s\n' "$src_repo"
  printf '📂 dest repo   %s\n' "$repo"
  printf '🔑 source key  %s\n' "$src_key"
  printf '🔑 dest key    %s\n' "$dest_key"
  echo

  local dest="$PROJECTS_DIR/$dest_key"

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    printf '🧪 dry run — would write %s\n' "$dest"
    [[ "$src_key" != "$dest_key" ]] && printf '🧪 dry run — would rewrite %s -> %s inside every transcript\n' "$src_repo" "$repo"
    python_helper list "$payload/projects/$src_key"
    return 0
  fi

  if [[ -d "$dest" ]] && [[ -n "$(ls -A "$dest" 2>/dev/null)" ]]; then
    local backup="$dest.backup.$(date +%Y%m%d_%H%M%S)"
    cp -a "$dest" "$backup"
    info "Existing store backed up to $backup"
  fi

  mkdir -p "$dest"
  cp -a "$payload/projects/$src_key/." "$dest/"

  if [[ "$src_repo" != "$repo" && "${NO_REWRITE:-0}" != "1" ]]; then
    info "Rewriting transcript paths: $src_repo -> $repo"
    python_helper rewrite "$dest" "$src_repo" "$repo"
  elif [[ "$src_repo" != "$repo" ]]; then
    printf '⚠️  Paths differ and --no-rewrite was passed. `--resume` will list the sessions, but\n'
    printf '    file references inside them still point at %s.\n' "$src_repo"
  fi

  if [[ -d "$payload/user" ]]; then
    # Never merged automatically: a user-level CLAUDE.md or settings.json can
    # carry hooks and env from the old machine that silently break here.
    local staged="$CLAUDE_HOME/imported-user-config.$(date +%Y%m%d_%H%M%S)"
    cp -a "$payload/user" "$staged"
    info "User-level config staged, NOT installed: $staged"
    info "Review it, then copy what you want into $CLAUDE_HOME by hand."
  fi

  echo
  printf '✅ Imported into %s\n' "$dest"
  echo
  info "Now run: scripts/claude_state_migrate.sh verify --repo $repo"
}

# ---------------------------------------------------------------- verify

cmd_verify() {
  local repo; repo="$(resolve_repo "${REPO_ARG:-}")"
  local key; key="$(key_for_path "$repo")"
  local dir="$PROJECTS_DIR/$key"

  printf '📂 repo  %s\n' "$repo"
  printf '📁 store %s\n' "$dir"
  echo

  [[ -d "$dir" ]] || die "No store at $dir — \`claude --resume\` in $repo would show an empty list."
  python_helper verify "$dir" "$repo"
}

# ---------------------------------------------------------------- arg parsing

[[ $# -ge 1 ]] || { sed -n '/^# USAGE/,/^# Run /p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }

SUB="$1"; shift
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_ARG="$2"; shift 2 ;;
    --out) OUT_ARG="$2"; shift 2 ;;
    --since) SINCE_ARG="$2"; shift 2 ;;
    --with-user-config) WITH_USER_CONFIG=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-rewrite) NO_REWRITE=1; shift ;;
    -h|--help) sed -n '/^# USAGE/,/^# Run /p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown flag: $1" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

case "$SUB" in
  list)    cmd_list ;;
  export)  cmd_export ;;
  inspect) cmd_inspect "${POSITIONAL[0]:-}" ;;
  import)  cmd_import "${POSITIONAL[0]:-}" ;;
  verify)  cmd_verify ;;
  *)       die "Unknown subcommand: $SUB (want: list, export, inspect, import, verify)" ;;
esac
