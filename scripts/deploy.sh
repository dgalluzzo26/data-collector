#!/usr/bin/env bash
# Deploy Data Collector as a Databricks App via Asset Bundle (ophammer-style).
#
# Usage:
#   ./scripts/deploy.sh              # deploy to dev (default)
#   ./scripts/deploy.sh prod
#   DATABRICKS_DEPLOY_FOLDER=/Workspace/MyApps ./scripts/deploy.sh dev
#
# Per-target catalog, schema, warehouse, and app name come from databricks.yml.
# app.yaml is patched for deploy only, then restored so git never carries prod state.
#
# Prerequisites: Databricks CLI authenticated, npm, python venv optional for setup.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-dev}"
DEPLOY_FOLDER="${DATABRICKS_DEPLOY_FOLDER:-/Workspace/DBRX-Apps}"
PROFILE="${DATABRICKS_CONFIG_PROFILE:-}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PROFILE="${DATABRICKS_CONFIG_PROFILE:-$PROFILE}"
if [[ "$TARGET" == "prod" && -z "$PROFILE" ]]; then
  PROFILE=fvm
fi

TARGET_JSON="$(python3 scripts/bundle_target.py "$TARGET")"
WAREHOUSE_ID="$(python3 -c "import json,sys; print(json.load(sys.stdin)['warehouse_id'])" <<<"$TARGET_JSON")"
TARGET_APP_NAME="$(python3 -c "import json,sys; print(json.load(sys.stdin)['app_name'])" <<<"$TARGET_JSON")"
TARGET_CATALOG="$(python3 -c "import json,sys; print(json.load(sys.stdin)['catalog'])" <<<"$TARGET_JSON")"
TARGET_SCHEMA="$(python3 -c "import json,sys; print(json.load(sys.stdin)['schema'])" <<<"$TARGET_JSON")"
APP_NAME="${DATABRICKS_APP_NAME:-$TARGET_APP_NAME}"

if [[ -n "${DATABRICKS_WAREHOUSE_ID:-}" && "$DATABRICKS_WAREHOUSE_ID" != "$WAREHOUSE_ID" ]]; then
  echo "NOTE: Ignoring DATABRICKS_WAREHOUSE_ID from .env for deploy."
  echo "      Using databricks.yml target '${TARGET}' warehouse: ${WAREHOUSE_ID}"
  echo "      (.env warehouse is for setup.sh / local dev only)"
fi

# Workaround: Databricks CLI <0.274.1 fails to download Terraform (expired PGP key, Apr 2026).
# Use system Terraform when available until CLI is upgraded.
if command -v terraform >/dev/null 2>&1; then
  export DATABRICKS_TF_EXEC_PATH="${DATABRICKS_TF_EXEC_PATH:-$(command -v terraform)}"
  if [[ -z "${DATABRICKS_TF_VERSION:-}" ]]; then
    DATABRICKS_TF_VERSION="$(terraform version | sed -n 's/^Terraform v//p' | awk '{print $1}')"
    export DATABRICKS_TF_VERSION
  fi
fi

# Avoid empty-array expansion — breaks on macOS bash 3.2 with `set -u`.
dbx() {
  if [[ -n "$PROFILE" ]]; then
    databricks -p "$PROFILE" "$@"
  else
    databricks "$@"
  fi
}

VAR_ARGS=(
  --var "deploy_folder=${DEPLOY_FOLDER}"
  --var "warehouse_id=${WAREHOUSE_ID}"
  --var "catalog=${TARGET_CATALOG}"
  --var "schema=${TARGET_SCHEMA}"
  --var "app_name=${APP_NAME}"
)

restore_app_yaml() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git checkout -- app.yaml 2>/dev/null || true
  fi
}
trap restore_app_yaml EXIT

echo "==> Workspace deploy folder: ${DEPLOY_FOLDER}"
echo "==> Bundle target: ${TARGET}"
echo "==> Target config: ${TARGET_CATALOG}.${TARGET_SCHEMA} warehouse=${WAREHOUSE_ID} app=${APP_NAME}"
echo "==> Ensuring workspace folder exists..."
dbx workspace mkdirs "${DEPLOY_FOLDER}"

echo "==> Syncing app.yaml for ${TARGET}..."
python3 scripts/sync_app_yaml.py "$TARGET"

echo "==> Building frontend (dist/)..."
npm run build

echo "==> Validating bundle..."
dbx bundle validate -t "$TARGET" "${VAR_ARGS[@]}"

echo "==> Deploying app (sync + create/update)..."
dbx bundle deploy -t "$TARGET" "${VAR_ARGS[@]}"

# Bundle TF replaces app resources with only what's in data-collector.app.yml (sql-warehouse).
# Postgres/Lakebase is not supported in bundle schema yet — re-attach via Apps API.
ENSURE_LAKEBASE="${ENSURE_LAKEBASE_APP_RESOURCE:-}"
if [[ -z "$ENSURE_LAKEBASE" ]]; then
  if [[ "$TARGET" == "prod" ]]; then
    ENSURE_LAKEBASE=true
  else
    ENSURE_LAKEBASE=false
  fi
fi
if [[ "$ENSURE_LAKEBASE" == "true" || "$ENSURE_LAKEBASE" == "1" ]]; then
  PYTHON_BIN="python3"
  if [[ -x .venv/bin/python ]]; then
    PYTHON_BIN=".venv/bin/python"
  fi
  LAKEBASE_ARGS=()
  # Prefer explicit env overrides; otherwise use databricks.yml lakebase_* defaults.
  LAKEBASE_BRANCH_VAL="${LAKEBASE_BRANCH:-}"
  LAKEBASE_DATABASE_VAL="${LAKEBASE_DATABASE:-}"
  if [[ -z "$LAKEBASE_BRANCH_VAL" || -z "$LAKEBASE_DATABASE_VAL" ]]; then
    TARGET_JSON_LB="$(python3 scripts/bundle_target.py "$TARGET")"
    if [[ -z "$LAKEBASE_BRANCH_VAL" ]]; then
      LAKEBASE_BRANCH_VAL="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('lakebase_branch',''))" <<<"$TARGET_JSON_LB")"
    fi
    if [[ -z "$LAKEBASE_DATABASE_VAL" ]]; then
      LAKEBASE_DATABASE_VAL="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('lakebase_database',''))" <<<"$TARGET_JSON_LB")"
    fi
  fi
  if [[ -n "$LAKEBASE_BRANCH_VAL" ]]; then
    LAKEBASE_ARGS+=(--lakebase-branch "$LAKEBASE_BRANCH_VAL")
  fi
  if [[ -n "$LAKEBASE_DATABASE_VAL" ]]; then
    LAKEBASE_ARGS+=(--lakebase-database "$LAKEBASE_DATABASE_VAL")
  fi
  if [[ -n "$PROFILE" ]]; then
    LAKEBASE_ARGS+=(--profile "$PROFILE")
  fi
  "$PYTHON_BIN" scripts/ensure_app_lakebase_resource.py \
    --app-name "$APP_NAME" \
    --warehouse-id "$WAREHOUSE_ID" \
    "${LAKEBASE_ARGS[@]}"
fi

echo "==> Starting app..."
dbx bundle run data-collector -t "$TARGET" "${VAR_ARGS[@]}"

restore_app_yaml
trap - EXIT

echo ""
echo "Done. Open the app from Databricks → Compute → Apps."
if [[ "$TARGET" == "dev" ]]; then
  echo "Bundle files synced under: ${DEPLOY_FOLDER}/data-collector/${TARGET}/<your-username>"
else
  echo "Bundle files synced under: ${DEPLOY_FOLDER}/data-collector/${TARGET}"
fi
echo ""
echo "Lakebase: prod deploy re-attaches the database app resource automatically"
echo "(ENSURE_LAKEBASE_APP_RESOURCE=false to skip). See docs/LAKEBASE.md."
echo ""
echo "If /api returns permission errors, grant the app service principal"
echo "USE CATALOG / SELECT / MODIFY on the app metadata schema only."
echo "Enable User authorization with the sql scope so collection data"
echo "access follows each user's Unity Catalog grants."
echo ""
echo "For member management (workspace user search + auto Can use grants), grant"
echo "the app service principal CAN_MANAGE on this app — see README.md §3b."
