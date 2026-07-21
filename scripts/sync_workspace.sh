#!/usr/bin/env bash
# Sync prebuilt app source to workspace for `databricks apps deploy`.
#
# Do NOT run bare `databricks sync . <dest>` — that uploads package.json and triggers
# server-side npm install (ENOTEMPTY failures). This script only syncs dist/, backend/,
# app.yaml, and requirements.txt.
#
# Usage:
#   ./scripts/sync_workspace.sh              # dev, one-shot
#   ./scripts/sync_workspace.sh --watch      # dev, watch for changes
#   ./scripts/sync_workspace.sh prod
#   ./scripts/sync_workspace.sh /Workspace/custom/path
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="dev"
WATCH=false
DEST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)
      WATCH=true
      shift
      ;;
    dev|prod)
      TARGET="$1"
      shift
      ;;
    *)
      DEST="$1"
      shift
      ;;
  esac
done

PROFILE="${DATABRICKS_CONFIG_PROFILE:-}"
if [[ "$TARGET" == "prod" && -z "$PROFILE" ]]; then
  PROFILE=fvm
fi

dbx() {
  if [[ -n "$PROFILE" ]]; then
    databricks -p "$PROFILE" "$@"
  else
    databricks "$@"
  fi
}

if [[ -z "$DEST" ]]; then
  DEPLOY_FOLDER="${DATABRICKS_DEPLOY_FOLDER:-/Workspace/DBRX-Apps}"
  USER_NAME="$(dbx current-user me -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['userName'])")"
  DEST="${DEPLOY_FOLDER}/data-collector/${TARGET}/${USER_NAME}/files"
fi

echo "==> Building frontend (dist/)..."
npm run build

echo "==> Removing stale npm artifacts from ${DEST}..."
for artifact in node_modules package.json package-lock.json .npmrc vite.config.ts tsconfig.json index.html; do
  if dbx workspace get-status "${DEST}/${artifact}" >/dev/null 2>&1; then
    if [[ "$artifact" == "node_modules" ]]; then
      dbx workspace delete "${DEST}/${artifact}" --recursive || true
    else
      dbx workspace delete "${DEST}/${artifact}" || true
    fi
  fi
done

SYNC_ARGS=(--include-from scripts/workspace_sync_include.txt --exclude node_modules)
if [[ "$WATCH" == true ]]; then
  SYNC_ARGS+=(--watch)
fi

echo "==> Syncing app source to ${DEST}..."
dbx sync . "${DEST}" "${SYNC_ARGS[@]}"
