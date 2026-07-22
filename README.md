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

Tables created: `projects`, `project_members`, `field_definitions`, `form_layouts`, `schema_versions`, `record_audit_log`, `app_settings`.

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
| `APP_ADMIN_EMAILS` | (empty) | Comma-separated workspace emails allowed to edit app branding (logo, title, colors) in **Settings**. Set in `app.yaml` for prod; see [§3c](#3c-app-administrators-branding). |
| `DATABRICKS_TF_EXEC_PATH` | system `terraform` | Path to Terraform binary (workaround for CLI PGP key issues). |
| `DATABRICKS_TF_VERSION` | auto-detected | Terraform version string for bundle. |

#### Unity Catalog metadata

| Variable | Used by | Description |
|----------|---------|-------------|
| `DATABRICKS_CATALOG` | `setup.sh`, local dev | UC catalog for app metadata tables. Match your **dev** target in `databricks.yml`. |
| `DATABRICKS_SCHEMA` | `setup.sh`, local dev | UC schema for app metadata (usually `data_collector`). |

**Do not hand-edit catalog/warehouse/app name in `app.yaml` for deploys.** `scripts/deploy.sh` reads `targets.<dev|prod>.variables` from `databricks.yml`, patches `app.yaml` for the deploy, then restores `app.yaml` from git so merges never carry prod state.

Provision metadata tables once per workspace:

```bash
./scripts/setup.sh
```

#### Multi-workspace development (dev vs prod)

This repo supports **two Databricks workspaces** with different catalogs:

| Target | Workspace | Catalog | App name |
|--------|-----------|---------|----------|
| `dev` | Coworker / classic stable (`fevm-classic-stable-kremer`) | `classic_stable_kremer_catalog` | `data-collector-dev` |
| `prod` | FVM serverless (`fvm` profile) | `serverless_stable_tgnklq_catalog` | `data-collector-prod` |

**Single source of truth:** `databricks.yml` → `targets.dev` and `targets.prod` → `variables` (`warehouse_id`, `catalog`, `schema`, `app_name`).

**After merging a coworker branch:**

1. Review the merge only for `targets.dev` — their catalog, host, and warehouse belong there.
2. **Do not change `targets.prod`** unless you intentionally move production.
3. Run `npm run deploy` for dev or `npm run deploy:prod` for prod — no manual `app.yaml` edits.
4. Each developer keeps a **local `.env`** for their own token and for `setup.sh` (catalog/schema for the workspace they provision).

**What lives where:**

| File | Commit? | Purpose |
|------|---------|---------|
| `databricks.yml` | Yes | Dev + prod target definitions (the only place for per-environment IDs) |
| `app.yaml` | Yes | App entrypoint, shared settings (`APP_ADMIN_EMAILS`, `UC_DATA_ACCESS_MODE`). Env-specific fields are dev defaults; deploy patches temporarily. |
| `.env` | No (gitignored) | Personal token, local dev catalog for `setup.sh` |

**Common mistake (what broke prod):** Coworker's dev catalog landed in committed `app.yaml`, while your `.env` had the prod warehouse. Deploy synced warehouse but not catalog. Deploy now reads **all** target variables from `databricks.yml` and ignores `.env` warehouse for deploy.

#### Lakebase (optional — collections with `storage_type: lakebase`)

| Variable | Default | Description |
|----------|---------|-------------|
| `ENSURE_LAKEBASE_APP_RESOURCE` | `true` for prod, `false` for dev | After `bundle deploy`, run `ensure_app_lakebase_resource.py` to re-attach the database app resource. |
| `LAKEBASE_BRANCH` | `projects/data-collector/branches/production` | Lakebase branch resource path for the `database` app resource. |
| `LAKEBASE_DATABASE` | `projects/data-collector/branches/production/databases/databricks-postgres` | Lakebase database resource path. |
| `LAKEBASE_DEFAULT_SCHEMA` | `data_collector` | Postgres schema name for Lakebase collections (set in `app.yaml`). |

`app.yaml` resolves `ENDPOINT_NAME` from the `database` app resource (`valueFrom: database`). Prod deploy re-attaches that resource automatically; see [Lakebase](#4-lakebase-database-resource-optional).

#### `databricks.yml` (per-target settings — edit here, not in `app.yaml`)

| Setting | Location | Dev | Prod |
|---------|----------|-----|------|
| Workspace host | `targets.dev.workspace.host` | `https://fevm-classic-stable-kremer.cloud.databricks.com/` | — |
| Prod CLI profile | `targets.prod.workspace.profile` | — | `fvm` |
| App name | `targets.*.variables.app_name` | `data-collector-dev` | `data-collector-prod` |
| Warehouse id | `targets.*.variables.warehouse_id` | `62c50dd91fadb932` | `3c333bc7e0c36cd6` |
| Catalog / schema | `targets.*.variables.catalog` / `schema` | `classic_stable_kremer_catalog` / `data_collector` | `serverless_stable_tgnklq_catalog` / `data_collector` |
| Lakebase paths | `variables.lakebase_branch` / `lakebase_database` | See Lakebase table above | Same |

#### Example `.env` for local dev / setup

```bash
# Personal token for CLI, setup.sh, and local uvicorn
DATABRICKS_HOST=https://fevm-classic-stable-kremer.cloud.databricks.com/
DATABRICKS_TOKEN=dapi...

# Metadata catalog for setup.sh in YOUR workspace (match targets.dev or your sandbox)
DATABRICKS_CATALOG=classic_stable_kremer_catalog
DATABRICKS_SCHEMA=data_collector
DATABRICKS_WAREHOUSE_ID=62c50dd91fadb932

# Optional overrides
# DATABRICKS_DEPLOY_FOLDER=/Workspace/DBRX-Apps
# DATABRICKS_APP_NAME=data-collector-prod
# APP_ADMIN_EMAILS=you@company.com,teammate@company.com

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

**Manual apps deploy** (sync + `databricks apps deploy` without the full bundle):

```bash
npm run apps:deploy     # build, sync dist/backend only, deploy dev app
npm run sync:workspace:watch   # watch sync (no package.json — avoids npm ENOTEMPTY on deploy)
```

Do **not** run bare `databricks sync . <workspace-path>` — it follows `.gitignore` only, uploads
`package.json`, and the app runtime will run `npm install` (often failing with `ENOTEMPTY` if
`node_modules` is partial). Use `scripts/sync_workspace.sh` instead.

`npm run deploy` will:

1. `mkdirs` the deploy folder (e.g. `/Workspace/DBRX-Apps`)
2. Read `warehouse_id`, `catalog`, `schema`, and `app_name` from `databricks.yml` for the target
3. Patch `app.yaml` for deploy, then restore it from git
4. `npm run build`
5. `databricks bundle validate` → `deploy`
5. Re-attach Lakebase `database` app resource on prod (if `ENSURE_LAKEBASE_APP_RESOURCE` is enabled)
6. `databricks bundle run` to start the app

### 3. Grant Unity Catalog permissions (required)

The deployed app uses **two identities** (configurable via `UC_DATA_ACCESS_MODE`, default **`hybrid`**):

| Layer | Identity | UC access |
|-------|----------|-----------|
| App metadata (projects, fields, members, lookups) | **Service principal** | Metadata schema only |
| UC browse (schema/table pickers, lookup bind, preview) | **App SP** in `hybrid`; **user OBO** in `user_obo` | SP needs UC read on catalogs browsed; `user_obo` uses user's grants |
| Collection data — **managed** tables (app-created) | **Service principal** (hybrid / `service_principal`) | SP needs CREATE + MODIFY on target schema; members get auto-GRANT on publish/add |
| Collection data — **existing UC** tables (`storage_mode=existing_uc`) | **Signed-in user** (hybrid / `user_obo`) | User's existing UC grants; optional auto-GRANT if SP has MANAGE on the table |

**`UC_DATA_ACCESS_MODE` values:**

| Value | Behavior |
|-------|----------|
| `hybrid` (default) | Managed UC collections: app SP runs record SQL and auto-grants members. Existing UC bindings: user OBO. |
| `service_principal` | All UC data SQL runs as the app SP (members need manual UC grants on data tables). |
| `user_obo` | All UC data SQL runs as the signed-in user (previous behavior). |

Without service-principal grants on the metadata schema, `/api/projects` returns **Internal Server Error** (`USE CATALOG` denied).

**Enable user authorization on the app** (required for **existing-UC collection data** in hybrid mode, and for all data access in `user_obo` mode):

Bundle deploy sets the **`sql`** and **`sql.warehouses`** scopes via `user_api_scopes` in `resources/data-collector.app.yml`. After deploy, **stop and restart** the app (`databricks bundle run` or the Apps UI). Users may need to re-open the app and approve the scope.

If you created the app outside the bundle, you can also set scopes in the UI:

1. **Compute → Apps →** your app → **Edit**
2. Under **User authorization**, enable it and add the **`sql`** scope
3. **Stop and restart** the app after changing scopes

Databricks forwards the user's short-lived token in the `X-Forwarded-Access-Token` header. The app uses it for UC **browse** SQL and **existing UC** collection data in hybrid mode so row/column policies and table grants apply per user.

**Genie Q&A** runs as the **app service principal** (not per-user). Spaces are created under `/Shared/brick-constructor/genie` and the app grants the SP `CAN_MANAGE` on each space. Members do not need individual Genie space permissions — only **Can use** on the app. After deploy, an admin should **Re-sync Genie space** once per form in Settings if spaces were created before this fix.

**Hybrid mode — service principal on data schemas (managed collections):**

Grant the app service principal enough privilege to create tables and grant members on publish (replace catalog/schema):

```sql
GRANT USE CATALOG ON CATALOG <data_catalog> TO `<service-principal-client-id>`;
GRANT USE SCHEMA ON SCHEMA <data_catalog>.<data_schema> TO `<service-principal-client-id>`;
GRANT CREATE TABLE ON SCHEMA <data_catalog>.<data_schema> TO `<service-principal-client-id>`;
GRANT MODIFY ON SCHEMA <data_catalog>.<data_schema> TO `<service-principal-client-id>`;
```

Members of published managed collections receive `SELECT` / `SELECT, MODIFY` on the collection table automatically (for notebook/SQL access outside the app). They do **not** need those grants to use the app itself.

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

In **`user_obo`** mode, collection **data tables** do not need grants on the service principal — each user needs their own UC grants on the target schemas/tables. In **`hybrid`** mode, managed collection tables are accessed by the SP (see above); existing UC bindings still require per-user grants unless auto-grant succeeds.

Users also need **CAN USE** on the SQL warehouse attached to the app.

Use the **client id UUID** in backticks — the display name (`app-xxxxx data-collector-prod`) often fails in `GRANT` statements.

**Grant users access to the app:** Compute → Apps → your app → **Permissions** → add users/groups with **Can use**.

### 3b. App service principal — Can manage (required for member management)

When collection admins add members, the app:

1. **Searches workspace users** (member picker autocomplete)
2. **Grants Can use on this app** to new members who do not already have app access

Both steps call Databricks workspace APIs as the **app service principal**. That principal must have **Can manage** on the app itself so it can update app permissions.

**One-time setup (per deployed app, e.g. `data-collector-prod`):**

1. **Compute → Apps →** your app → **Permissions**
2. Find the app **service principal** (same client id as in [§3](#3-grant-unity-catalog-permissions-required), e.g. `b73ec2ef-401b-47f4-8ca9-b7a2790320a5`)
3. Set permission to **Can manage** (not only Can use)

Or via CLI (replace app name and service principal client id):

```bash
databricks apps update-permissions data-collector-prod -p fvm --json '{
  "access_control_list": [
    {
      "service_principal_name": "b73ec2ef-401b-47f4-8ca9-b7a2790320a5",
      "permission_level": "CAN_MANAGE"
    }
  ]
}'
```

Without this grant, member search may fail and auto **Can use** grants will not apply — you can still type an email manually, but new members may see the access-denied page until an admin adds them under **App → Permissions**.

`DATABRICKS_APP_NAME` in `app.yaml` (synced by `deploy.sh`) must match the deployed app name so permission grants target the correct app.

### 3c. App administrators (branding)

App **branding** (logo, title, light/dark color palettes) is editable only by users listed in `APP_ADMIN_EMAILS`. Everyone else sees the configured branding but does not get the admin panel in **Settings**.

**Prod — set in `app.yaml` before deploy** (comma-separated workspace emails):

```yaml
env:
  - name: APP_ADMIN_EMAILS
    value: "admin@company.com,other.admin@company.com"
```

`deploy.sh` syncs warehouse id and app name into `app.yaml`; add or update `APP_ADMIN_EMAILS` in that file and redeploy when admins change.

**Local dev — set in `.env`:**

```bash
APP_ADMIN_EMAILS=you@company.com
```

Also set `DEV_USER_EMAIL` to the same address so `/api/me` and `/api/health` report `is_app_admin: true` locally.

Branding is stored in the `app_settings` UC table (created by `scripts/setup.py`). Predefined palettes: Databricks, DHS Government, Slate Neutral, or custom colors.

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
| **App SP has Can manage on the app** | Member picker finds users; adding a member grants them **Can use** on the app |
| **`APP_ADMIN_EMAILS` in `app.yaml`** | Listed admins see **App branding** in Settings |
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
| Member search fails in prod | Grant the app **service principal** **Can manage** on the app (see [§3b](#3b-app-service-principal--can-manage-required-for-member-management)); type email manually as fallback |
| Auto app access not granted for new members | Same — app SP needs **Can manage** on the app; check `DATABRICKS_APP_NAME` matches deployed app name |
| `permission denied for schema data_collector` on records | Run `scripts/repair_lakebase_grants.py` locally as schema owner (see [LAKEBASE.md](docs/LAKEBASE.md)) |

## Related documentation

- [docs/LAKEBASE.md](docs/LAKEBASE.md) — Lakebase Postgres storage setup
- [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) — full product plan (lookups, AI builder, roadmap)
- [docs/ROADMAP.md](docs/ROADMAP.md) — implementation checklist

## License

Internal use unless otherwise specified.
