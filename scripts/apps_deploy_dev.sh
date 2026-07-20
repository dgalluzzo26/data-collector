#!/usr/bin/env bash
# Build, sync (without package.json), and deploy the dev Databricks App.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-dev}"
TARGET_JSON="$(python3 scripts/bundle_target.py "$TARGET")"
APP_NAME="$(python3 -c "import json,sys; print(json.load(sys.stdin)['app_name'])" <<<"$TARGET_JSON")"

./scripts/sync_workspace.sh "$TARGET"

DEPLOY_FOLDER="${DATABRICKS_DEPLOY_FOLDER:-/Workspace/DBRX-Apps}"
PROFILE="${DATABRICKS_CONFIG_PROFILE:-}"
dbx() {
  if [[ -n "$PROFILE" ]]; then
    databricks -p "$PROFILE" "$@"
  else
    databricks "$@"
  fi
}

USER_NAME="$(dbx current-user me -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['userName'])")"
SOURCE_PATH="${DEPLOY_FOLDER}/data-collector/${TARGET}/${USER_NAME}/files"

echo "==> Deploying ${APP_NAME} from ${SOURCE_PATH}..."
dbx apps deploy "${APP_NAME}" --source-code-path "${SOURCE_PATH}"

echo "Done."
