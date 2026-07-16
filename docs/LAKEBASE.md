# Lakebase storage for Data Collector

Collections can use **`storage_type: lakebase`** to store records in **Lakebase Postgres** instead of Unity Catalog Delta tables. App metadata (projects, fields, members, lookups) always stays in UC Delta.

Full deployment steps (UC grants, app permissions, Lakebase resource) are in [README.md](../README.md#deploy-to-databricks-apps).

## Deployed app (Databricks Apps)

### 1. Lakebase database app resource

Create a **Lakebase Postgres** project in the workspace (if you do not have one).

For this workspace:

| Field | Value |
|-------|--------|
| Project | `data-collector` |
| Branch | `production` |
| Database | `databricks_postgres` |
| Resource key | `database` (must match `valueFrom` in `app.yaml`) |

**Prod deploy re-attaches this automatically.** `scripts/deploy.sh` runs `ensure_app_lakebase_resource.py` after `bundle deploy` because bundle Terraform only supports `sql_warehouse` in `resources/data-collector.app.yml` — it cannot declare `postgres` yet and would drop the database resource on every deploy.

Optional `.env` overrides (defaults match `databricks.yml`):

```bash
LAKEBASE_BRANCH=projects/data-collector/branches/production
LAKEBASE_DATABASE=projects/data-collector/branches/production/databases/databricks-postgres
ENSURE_LAKEBASE_APP_RESOURCE=true   # prod default; set false to skip
```

Manual one-time setup (or if you deploy without `deploy.sh`):

1. **Compute → Apps →** your app → **Edit**
2. **App resources → + Add resource → Database**
3. Select project / branch / database above, permission **Can connect and create**, key **`database`**

Or run:

```bash
python3 scripts/ensure_app_lakebase_resource.py \
  --app-name data-collector-prod \
  --warehouse-id "$DATABRICKS_WAREHOUSE_ID" \
  --profile fvm
```

Databricks creates a Postgres role for the app's service principal and injects `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPORT`, `PGSSLMODE`.

### 2. Configure `app.yaml`

The repo ships with:

```yaml
env:
  - name: ENDPOINT_NAME
    valueFrom: database
  - name: LAKEBASE_DEFAULT_SCHEMA
    value: data_collector
```

`valueFrom: database` resolves to the Lakebase endpoint path (`projects/.../branches/.../endpoints/...`) at runtime — you do not need to copy it manually from the Connect dialog.

### 3. Redeploy

```bash
npm run deploy:prod
```

### 4. Verify

Open the app → **Settings**:

- `Lakebase configured: yes`
- `Lakebase database` shows your Postgres database name

## Manual `ENDPOINT_NAME` (optional)

If not using `valueFrom: database`, copy the resource name from Lakebase → your branch → **Computes** → **primary** → **Get ID** → **Copy resource name**, then set in `app.yaml`:

```yaml
  - name: ENDPOINT_NAME
    value: projects/<project-id>/branches/<branch-id>/endpoints/<endpoint-id>
```

The Connect dialog hostname (e.g. `ep-fancy-waterfall-....database....databricks.com`) is **not** the endpoint name.

## Local development

Add to `.env` (use **your email** as `PGUSER`, not the service principal client id):

```bash
PGHOST=ep-xxxx.database.us-east-2.cloud.databricks.com
PGDATABASE=databricks_postgres
PGUSER=you@company.com
PGPORT=5432
PGSSLMODE=require
ENDPOINT_NAME=projects/.../branches/.../endpoints/...
LAKEBASE_DEFAULT_SCHEMA=data_collector
```

Get `ENDPOINT_NAME` from Lakebase → Computes → **Get ID** → **Copy resource name**.

Install deps: `pip install -r requirements.txt` (includes `psycopg[binary,pool]`).

## Creating a Lakebase collection

1. **New collection** → Storage → **Lakebase (Postgres)**
2. Optionally customize **schema** and **table** name (database comes from `PGDATABASE`)
3. Design form → **Publish** (creates Postgres schema/table)

## Limitations (v1)

- **Genie Q&A** for Lakebase collections requires a **Unity Catalog sync location** (configured in Databricks outside this app). Set catalog, schema, and table in collection Settings after enabling Lakehouse Sync or UC registration.
- Lookups and metadata still use the SQL warehouse / UC metadata schema

## Troubleshooting

### `permission denied for schema data_collector` (prod 500 on `/records`)

**Cause:** Collection tables were published from **local dev** using your workspace email as `PGUSER`. The **prod app** connects as a different Postgres role (the app service principal). That role does not automatically get `USAGE` on schemas you created locally.

**Fix (one-time, run locally as schema owner):**

1. Find the prod app Postgres user: **Compute → Apps → data-collector-prod → Environment** → copy `PGUSER`.
2. From the repo (with Lakebase vars in `.env`):

```bash
export LAKEBASE_ADDITIONAL_GRANTEES='<paste-prod-PGUSER-here>'
.venv/bin/python scripts/repair_lakebase_grants.py
```

Or repair one collection:

```bash
.venv/bin/python scripts/repair_lakebase_grants.py --project-id ceda02fd-93ba-4057-aff4-b4301c8fc06a
```

**Prevention:** New publishes automatically run `ensure_collection_grants()` so the prod app role can access tables. Re-publish or run the repair script for collections published before this fix.
