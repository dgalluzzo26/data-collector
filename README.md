# Data Collector

A Databricks App for ingesting, validating, and managing enterprise data collections. Built from the **dhs-ophammer** project template (React + FastAPI + Node) with the **DHS Scorecard** layout shell — navy sidebar, header bar, DHS brand colors, and content-area dark/light mode.

## Architecture

- **Frontend** — React + Vite + MUI, built to `dist/` (`npm run build`)
- **Backend** — FastAPI (`backend/`); API under `/api`, serves `dist/` in production
- **Data** — Unity Catalog tables on a Databricks SQL warehouse (configure via env vars)
- **Layout** — Scorecard-style app shell (`src/components/layout/AppShell.tsx`)

## Prerequisites

- Node.js 20+
- Python 3.11+
- Databricks SQL warehouse + personal access token

## Provision metadata tables (first deploy)

App metadata lives in Unity Catalog:

| Default | Value |
|---------|-------|
| Catalog | `serverless_stable_tgnklq_catalog` |
| Schema | `data_collector` |

Tables created: `projects`, `project_members`, `field_definitions`, `form_layouts`, `schema_versions`, `record_audit_log`.

### Python script (recommended — no Databricks CLI)

```bash
python3 -m venv .venv
PIP_CONFIG_FILE=pip.conf .venv/bin/pip install -r requirements.txt

./scripts/setup.sh \
  --host "https://<workspace>.cloud.databricks.com" \
  --token "dapi..." \
  --warehouse-id "<warehouse-id>"
```

Use `./scripts/setup.sh` (or `.venv/bin/python3 scripts/setup.py`) so the correct venv is used.
Plain `python3` may point at a different interpreter without the Databricks packages installed.

Or set env vars / `.env` and run with defaults:

```bash
cp .env.example .env   # edit HOST, TOKEN, WAREHOUSE_ID
python scripts/setup.py
```

Override catalog/schema:

```bash
python scripts/setup.py --catalog serverless_stable_tgnklq_catalog --schema data_collector
```

### SQL editor (no Python connection)

```bash
python scripts/setup.py --emit-sql   # writes sql/schema.sql
```

Run `sql/schema.sql` in a Databricks SQL warehouse or notebook.

## Quick start (local)

```bash
# Install dependencies (Databricks internal PyPI proxy — see pip.conf)
python3 -m venv .venv && source .venv/bin/activate
PIP_CONFIG_FILE=pip.conf pip install -r requirements.txt
npm install

# Configure
cp .env.example .env
# Edit: DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID

# Run backend + frontend together
npm run dev:all
```

Open http://localhost:5173 — Vite proxies `/api` to port 8000.

## Layout

The app shell matches DHS Scorecard:

| Element | Behavior |
|---------|----------|
| Sidebar | Navy gradient, collapsible, DHS wordmark/seal |
| Header bar | `DhsSiteHeader` with route title and tagline |
| Dark/light toggle | Content area only — sidebar and header stay navy |
| Colors | DHS brand tokens in `src/assets/dhs-brand.css` |

## Project structure

```
data-collector/
├── backend/
│   ├── schema_ddl.py     # Metadata table DDL (single source of truth)
│   └── provisioning.py   # Execute DDL against SQL warehouse
├── sql/schema.sql        # Generated DDL for SQL editor / CLI
├── scripts/
│   ├── setup.py          # Provision metadata via SQL warehouse
│   ├── setup.sh
│   ├── deploy.sh         # Bundle deploy to /Workspace/DBRX-Apps
│   └── ensure_app_lakebase_resource.py  # Re-attach Lakebase after bundle deploy
├── resources/data-collector.app.yml
├── databricks.yml        # Asset bundle config
├── src/
│   ├── components/
│   │   ├── brand/        # DhsSiteHeader
│   │   └── layout/       # AppShell (Scorecard layout)
│   ├── assets/           # DHS brand CSS + content theme
│   └── hooks/            # useContentTheme
├── public/images/        # DHS logo + wordmark SVGs
├── scripts/dev.sh        # Local dev (backend + frontend)
├── app.yaml              # Databricks App entry
└── requirements.txt
```

## Deploy to Databricks Apps

Based on the **dhs-ophammer** bundle flow. One script builds, creates the workspace folder, and deploys.

### Deployment configuration reference

Copy `.env.example` to `.env` and set values for your workspace. `scripts/deploy.sh` sources `.env` automatically.

#### Required (`.env`)

| Variable | Used by | Description |
|----------|---------|-------------|
| `DATABRICKS_WAREHOUSE_ID` | `deploy.sh`, `app.yaml`, runtime | SQL warehouse id the app binds to (`CAN_USE`). Synced into `app.yaml` before each deploy. |

#### CLI auth (`.env` or `~/.databrickscfg`)

| Variable | Used by | Description |
|----------|---------|-------------|
| `DATABRICKS_CONFIG_PROFILE` | `deploy.sh`, `ensure_app_lakebase_resource.py` | Databricks CLI profile name. **Prod defaults to `fvm`** if unset. Dev uses your default profile if unset. |
| `DATABRICKS_HOST` | `setup.sh`, local dev | Workspace URL (e.g. `https://fevm-serverless-stable-tgnklq.cloud.databricks.com`). |
| `DATABRICKS_TOKEN` | `setup.sh`, local dev | Personal access token for provisioning and local API calls. Not used by the deployed app (service principal). |

Configure the CLI profile once:

```bash
echo "dapi<your-token>" | databricks configure \
  --host "https://<workspace>.cloud.databricks.com" \
  --profile fvm
```

#### Optional deploy overrides (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABRICKS_DEPLOY_FOLDER` | `/Workspace/DBRX-Apps` | Workspace folder for bundle artifacts. Created by `deploy.sh` if missing. |
| `DATABRICKS_APP_NAME` | `data-collector-dev` / `data-collector-prod` | Override deployed app name per target. |
| `DATABRICKS_TF_EXEC_PATH` | system `terraform` | Path to Terraform binary (workaround for CLI PGP key issues). |
| `DATABRICKS_TF_VERSION` | auto-detected | Terraform version string for bundle. |

#### Unity Catalog metadata (`.env` for setup; `app.yaml` at runtime)

Keep these aligned across `.env`, `databricks.yml`, and `app.yaml`:

| Variable / `app.yaml` env | Default | Description |
|---------------------------|---------|-------------|
| `DATABRICKS_CATALOG` / `DATABRICKS_CATALOG` | `serverless_stable_tgnklq_catalog` | UC catalog for app metadata tables (`projects`, `field_definitions`, etc.). |
| `DATABRICKS_SCHEMA` / `DATABRICKS_SCHEMA` | `data_collector` | UC schema for app metadata. |

Provision metadata tables once per workspace:

```bash
./scripts/setup.sh
```

#### Lakebase (optional — collections with `storage_type: lakebase`)

| Variable | Default | Description |
|----------|---------|-------------|
| `ENSURE_LAKEBASE_APP_RESOURCE` | `true` for prod, `false` for dev | After `bundle deploy`, run `ensure_app_lakebase_resource.py` to re-attach the database app resource. |
| `LAKEBASE_BRANCH` | `projects/data-collector/branches/production` | Lakebase branch resource path for the `database` app resource. |
| `LAKEBASE_DATABASE` | `projects/data-collector/branches/production/databases/databricks-postgres` | Lakebase database resource path. |
| `LAKEBASE_DEFAULT_SCHEMA` | `data_collector` | Postgres schema name for Lakebase collections (set in `app.yaml`). |

`app.yaml` resolves `ENDPOINT_NAME` from the `database` app resource (`valueFrom: database`). Prod deploy re-attaches that resource automatically; see [Lakebase](#4-lakebase-database-resource-optional).

#### `databricks.yml` (edit once per workspace)

| Setting | Location | Default (this workspace) |
|---------|----------|--------------------------|
| Workspace host | `targets.dev.workspace.host` | `https://fevm-serverless-stable-tgnklq.cloud.databricks.com` |
| Prod CLI profile | `targets.prod.workspace.profile` | `fvm` |
| App name (dev) | `targets.dev.variables.app_name` | `data-collector-dev` |
| App name (prod) | `targets.prod.variables.app_name` | `data-collector-prod` |
| Warehouse id | `variables.warehouse_id` / per-target | `3c333bc7e0c36cd6` |
| Catalog / schema | `variables.catalog` / `variables.schema` | `serverless_stable_tgnklq_catalog` / `data_collector` |
| Lakebase paths | `variables.lakebase_branch` / `lakebase_database` | See Lakebase table above |

#### Example `.env` for deploy

```bash
# Required
DATABRICKS_WAREHOUSE_ID=3c333bc7e0c36cd6

# CLI (prod uses profile fvm by default)
DATABRICKS_CONFIG_PROFILE=fvm
DATABRICKS_HOST=https://fevm-serverless-stable-tgnklq.cloud.databricks.com
DATABRICKS_TOKEN=dapi...

# Metadata (setup + keep in sync with app.yaml)
DATABRICKS_CATALOG=serverless_stable_tgnklq_catalog
DATABRICKS_SCHEMA=data_collector

# Optional overrides
# DATABRICKS_DEPLOY_FOLDER=/Workspace/DBRX-Apps
# DATABRICKS_APP_NAME=data-collector-prod

# Lakebase (prod re-attaches automatically)
# LAKEBASE_BRANCH=projects/data-collector/branches/production
# LAKEBASE_DATABASE=projects/data-collector/branches/production/databases/databricks-postgres
# ENSURE_LAKEBASE_APP_RESOURCE=true
```

### 1. Configure workspace auth

Edit `databricks.yml` → set `targets.dev.workspace.host` (and `targets.prod.workspace.profile` if not `fvm`).

Create a Databricks CLI profile if you have not already (see [CLI auth](#cli-auth-env-or-databrickscfg) above).

Provision metadata tables first (once per workspace):

```bash
./scripts/setup.sh
```

### 2. Deploy the app

```bash
npm run deploy          # dev → /Workspace/DBRX-Apps/data-collector/dev/<your-email>
npm run deploy:prod     # prod
```

The script will:

1. `mkdirs` the deploy folder (e.g. `/Workspace/DBRX-Apps`)
2. Sync `DATABRICKS_WAREHOUSE_ID` into `app.yaml`
3. `npm run build`
4. `databricks bundle validate` → `deploy`
5. Re-attach Lakebase `database` app resource on prod (if `ENSURE_LAKEBASE_APP_RESOURCE` is enabled)
6. `databricks bundle run` to start the app

### 3. Grant Unity Catalog permissions (required)

The deployed app uses **two identities**:

| Layer | Identity | UC access |
|-------|----------|-----------|
| App metadata (projects, fields, members, lookups) | **Service principal** | Metadata schema only |
| Collection data (records, UC table bind/preview, existing-UC writes) | **Signed-in user** (on-behalf-of) | User's existing UC grants |

Without service-principal grants on the metadata schema, `/api/projects` returns **Internal Server Error** (`USE CATALOG` denied).

**Enable user authorization on the app** (required for record writes and UC schema/table pickers):

1. **Compute → Apps →** your app → **Edit**
2. Under **User authorization**, enable it and add the **`sql`** scope
3. **Stop and restart** the app after changing scopes

Databricks forwards the user's short-lived token in the `X-Forwarded-Access-Token` header. The app uses it for all Unity Catalog **data-plane** SQL so row/column policies and table grants apply per user.

**Find the service principal client id** (metadata only):

1. **Compute → Apps →** your app (e.g. `data-collector-prod`)
2. Open the **Authorization** or app details tab
3. Copy **Service principal client ID** (UUID, e.g. `b73ec2ef-401b-47f4-8ca9-b7a2790320a5`)

Or via CLI:

```bash
databricks apps get data-collector-prod -p data-collector -o json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['service_principal_client_id'])"
```

**Run grants in a SQL warehouse** (replace catalog/schema and principal id):

```sql
-- App metadata schema only (projects, fields, members, lookups, staged changes)
GRANT USE CATALOG ON CATALOG serverless_stable_tgnklq_catalog TO `<service-principal-client-id>`;
GRANT USE SCHEMA ON SCHEMA serverless_stable_tgnklq_catalog.data_collector TO `<service-principal-client-id>`;
GRANT SELECT, MODIFY ON SCHEMA serverless_stable_tgnklq_catalog.data_collector TO `<service-principal-client-id>`;
```

Collection **data tables** do not need grants on the service principal — each user needs their own UC grants on the target schemas/tables. Users also need **CAN USE** on the SQL warehouse attached to the app.

Use the **client id UUID** in backticks — the display name (`app-xxxxx data-collector-prod`) often fails in `GRANT` statements.

**Grant users access to the app:** Compute → Apps → your app → **Permissions** → add users/groups with **Can use**.

### 4. Lakebase database resource (optional)

Required only if you want collections with **Storage → Lakebase (Postgres)**. App metadata still lives in UC Delta; record tables can live in Lakebase.

Create a **Lakebase Postgres** project in the workspace (app switcher → Lakebase Postgres). For this workspace: project `data-collector`, branch `production`, database `databricks_postgres`, resource key **`database`**.

`app.yaml` already includes:

```yaml
env:
  - name: ENDPOINT_NAME
    valueFrom: database
  - name: LAKEBASE_DEFAULT_SCHEMA
    value: data_collector
```

**Prod deploy re-attaches the database resource automatically.** Bundle Terraform only manages `sql_warehouse` in `resources/data-collector.app.yml` and would drop Lakebase on every deploy; `scripts/deploy.sh` runs `ensure_app_lakebase_resource.py` after `bundle deploy` to restore it via the Apps API.

```bash
npm run deploy:prod
```

Override paths in `.env` if needed (`LAKEBASE_BRANCH`, `LAKEBASE_DATABASE`). Set `ENSURE_LAKEBASE_APP_RESOURCE=false` to skip.

**Verify:** open the app → **Settings** → `Lakebase configured` should be **yes**.

See [docs/LAKEBASE.md](docs/LAKEBASE.md) for local dev connection vars and limitations (Genie is UC-only).

### 5. Post-deploy checklist

| Step | Verify |
|------|--------|
| UC grants on metadata schema (service principal) | Collections page loads (no Internal Server Error) |
| User authorization + `sql` scope enabled | UC schema/table dropdowns and record writes respect user permissions |
| App permissions for your user | You can open the app URL |
| SQL warehouse bound | Settings shows warehouse id / `db_status: ok` |
| Lakebase resource (if used) | Settings shows `Lakebase configured: yes` |
| Collection membership | Your workspace email is a project member (not only `local-dev@example.com`) |

For local dev, set `DEV_USER_EMAIL=you@company.com` in `.env` so collections match the deployed app identity.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `CLI_ARGS unbound variable` on macOS | Fixed in `deploy.sh` — pull latest |
| `openpgp: key expired` on bundle deploy | Upgrade Databricks CLI or use system Terraform (`DATABRICKS_TF_EXEC_PATH`) |
| Internal Server Error on Collections | UC grants for service principal on metadata schema |
| 403 on record save / UC schema list | Enable User authorization + `sql` scope; grant user UC access on target tables |
| Empty collections in prod | Add your email to `project_members` or set `DEV_USER_EMAIL` locally |
| Lakebase option fails on create | Redeploy with latest `deploy.sh` (auto re-attaches database); check Settings |

## Related documentation

- [docs/LAKEBASE.md](docs/LAKEBASE.md) — Lakebase Postgres storage setup
- [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) — full product plan (lookups, AI builder, roadmap)
- [docs/ROADMAP.md](docs/ROADMAP.md) — implementation checklist

## License

Internal use unless otherwise specified.
