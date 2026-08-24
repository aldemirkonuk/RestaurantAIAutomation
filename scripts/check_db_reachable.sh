#!/usr/bin/env bash
# Preflight for every job that connects to the remote Supabase database.
#
# Why this exists
# ---------------
# On 2026-08-24 all three Schema-parity jobs failed with a raw psql/psycopg2
# traceback ending in "Network is unreachable". The cause was not schema drift
# and not a missing secret: `db.<ref>.supabase.co` publishes **only an AAAA
# record**, and GitHub-hosted runners have no IPv6 route. Supabase moved direct
# connections to IPv6-only; IPv4 needs either the paid add-on or the Supavisor
# pooler, which is IPv4-reachable.
#
# Diagnosing that cost a full log dig. This script turns the same failure into
# one sentence naming the fix.
#
# It never makes a failing check pass. An unreachable database is a real
# failure — the point is only that it should say why.
#
# Never prints the DSN: it carries credentials.
set -uo pipefail

DSN="${SUPABASE_DB_URL:-${SUPABASE_POOLER_URL:-${SUPABASE_POOLER_CONNECTION_STRING:-${SUPABASE_DIRECT_CONNECTION_STRING:-}}}}"

if [ -z "$DSN" ]; then
  echo "::error::No database connection string set."
  echo "::error::Set SUPABASE_POOLER_URL (the name already used in .env) or SUPABASE_POOLER_CONNECTION_STRING."
  exit 1
fi

# host is between the last '@' and the following ':' or '/'
host=$(printf '%s' "$DSN" | sed -E 's|^[^@]*@||; s|[:/?].*$||')
if [ -z "$host" ]; then
  echo "::error::Could not parse a hostname from the connection string."
  exit 1
fi

# Portable resolution: getent on Linux runners, dig/python elsewhere so this
# script is testable on a developer machine and not only in CI.
resolve() { # $1=host  $2=4|6
  local h="$1" v="$2"
  if command -v getent >/dev/null 2>&1; then
    getent "ahostsv${v}" "$h" 2>/dev/null | head -1 && return 0
  fi
  if command -v dig >/dev/null 2>&1; then
    dig +short "$([ "$v" = 4 ] && echo A || echo AAAA)" "$h" 2>/dev/null | grep -vE '\.$' | head -1 && return 0
  fi
  python3 -c "import socket,sys
fam = socket.AF_INET if '$v'=='4' else socket.AF_INET6
try: print(socket.getaddrinfo('$h', None, fam)[0][4][0])
except Exception: pass" 2>/dev/null
}

echo "Resolving ${host} ..."
have_a=$(resolve "$host" 4)
have_aaaa=$(resolve "$host" 6)

if [ -n "$have_a" ]; then
  echo "IPv4 route available. Proceeding."
  exit 0
fi

if [ -n "$have_aaaa" ]; then
  echo "::error::${host} resolves to IPv6 only, and GitHub-hosted runners have no IPv6 route."
  echo "::error::This is a connectivity problem, NOT schema drift. The check cannot run at all."
  echo "::error::Fix: use the Supavisor pooler, which is IPv4-reachable."
  echo "::error::  1. Supabase dashboard -> Project Settings -> Database -> Connection string -> 'Session pooler'"
  echo "::error::  2. It looks like: postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
  echo "::error::  3. Save it as the repository secret SUPABASE_POOLER_URL (same name as .env)"
  echo "::error::Alternative: buy the Supabase IPv4 add-on to keep using the direct host."
  exit 1
fi

echo "::error::${host} does not resolve at all (no A and no AAAA record)."
echo "::error::Check the project ref in the connection string, and that the project is not paused."
exit 1
