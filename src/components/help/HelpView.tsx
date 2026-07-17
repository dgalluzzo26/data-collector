import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

type HelpTab = 'using' | 'setup' | 'deployment';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper className="page-card" sx={{ p: 2.5, mb: 2 }}>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function Code({ children }: { children: string }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        borderRadius: 1,
        bgcolor: 'action.hover',
        fontSize: '0.8rem',
        overflow: 'auto',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {children}
    </Box>
  );
}

function BulletList({ items }: { items: ReactNode[] }) {
  return (
    <Box component="ul" sx={{ pl: 2.5, m: 0, color: 'text.secondary', '& li': { mb: 0.75 } }}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </Box>
  );
}

function UsingHelp() {
  return (
    <>
      <Section title="What is Brick Constructor?">
        <Typography variant="body2" color="text.secondary" paragraph>
          Brick Constructor lets teams build custom data collection forms, share a data-entry link with
          contributors, and store submitted records in Databricks (Unity Catalog or Lakebase
          Postgres). Form <strong>metadata</strong> (fields, members, settings) always lives in
          Unity Catalog; <strong>record rows</strong> live in the storage you choose per form.
        </Typography>
      </Section>

      <Section title="Your role on a form">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Each form has its own membership. Your role controls what you can do:
        </Typography>
        <Table size="small" sx={{ mb: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell>Role</TableCell>
              <TableCell>What you can do</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Admin</TableCell>
              <TableCell>
                Design the form, manage lookups and members, change storage settings, publish, and
                enter or edit records
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Editor</TableCell>
              <TableCell>Enter, edit, import, and export records on published forms</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Reader</TableCell>
              <TableCell>View records only</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Typography variant="body2" color="text.secondary">
          You must be added as a member to see a form. If you open a data-entry link without
          access, the page shows form admins you can email to request access.
        </Typography>
      </Section>

      <Section title="Creating and publishing a form (admins)">
        <BulletList
          items={[
            <>
              Go to <strong>Forms → New form</strong> (manual or AI-assisted).
            </>,
            <>
              Open the form workspace. Use <strong>Form designer</strong> to add fields,{' '}
              <strong>Lookup tables</strong> for dropdown data, and <strong>Settings</strong> for
              storage (Unity Catalog or Lakebase).
            </>,
            <>
              Use the <strong>Members</strong> tab to add workspace users. Search by name or email;
              new members are automatically granted <strong>Can use</strong> on this app when
              needed.
            </>,
            <>
              Click <strong>Publish</strong> when the form is ready. Publishing creates the backing
              record table and makes the form available for data entry.
            </>,
            <>
              Copy the <strong>Data entry URL</strong> from the form workspace and share it
              with editors and viewers.
            </>,
          ]}
        />
      </Section>

      <Section title="Entering and managing records">
        <BulletList
          items={[
            <>
              Open the <strong>data-entry URL</strong> or the <strong>Records</strong> tab in the
              form workspace.
            </>,
            <>
              Use column headers to <strong>sort</strong>. Use the toolbar <strong>Filters</strong>{' '}
              or <strong>Search</strong> box to find rows.
            </>,
            <>
              Click <strong>New record</strong> or a row to add or edit data in the side panel.
            </>,
            <>
              Use <strong>Import CSV</strong> / <strong>Export CSV</strong> for bulk work (editors
              and admins).
            </>,
            <>
              Click the <strong>refresh</strong> icon to load the latest data when others are
              editing at the same time.
            </>,
          ]}
        />
      </Section>

      <Section title="Genie Q&A">
        <Typography variant="body2" color="text.secondary">
          On published forms with a configured sync location (Lakebase) or Unity Catalog
          table, the <strong>Genie Q&A</strong> tab lets you ask natural-language questions about
          the data. Admins can provision or re-sync Genie from form settings when needed.
        </Typography>
      </Section>

      <Section title="Tips">
        <BulletList
          items={[
            'Use the header dark/light toggle to change only the main content area.',
            'Check Settings in the sidebar to confirm this deployment is connected to the warehouse and Lakebase.',
            'If records fail to load in production after publishing from your laptop, ask an admin to run the Lakebase grant repair script (see Setup tab).',
          ]}
        />
      </Section>
    </>
  );
}

function SetupHelp() {
  return (
    <>
      <Section title="Overview">
        <Typography variant="body2" color="text.secondary" paragraph>
          Setup is a <strong>one-time per workspace</strong> task for platform admins. End users
          only need <strong>Can use</strong> on the deployed app and membership on individual
          collections.
        </Typography>
      </Section>

      <Section title="1. Provision metadata tables">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          App metadata (projects, fields, members, lookups) lives in Unity Catalog, default{' '}
          <code>serverless_stable_tgnklq_catalog.data_collector</code>.
        </Typography>
        <Code>{`python3 -m venv .venv
PIP_CONFIG_FILE=pip.conf .venv/bin/pip install -r requirements.txt

cp .env.example .env   # set DATABRICKS_HOST, TOKEN, WAREHOUSE_ID
./scripts/setup.sh`}</Code>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Or run <code>python scripts/setup.py --emit-sql</code> and execute{' '}
          <code>sql/schema.sql</code> in a SQL warehouse.
        </Typography>
      </Section>

      <Section title="2. Grant Unity Catalog access to the app service principal">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The deployed app runs as a <strong>service principal</strong>, not your personal token.
          Find its client id under <strong>Compute → Apps → your app → Authorization</strong>.
        </Typography>
        <Code>{`GRANT USE CATALOG ON CATALOG serverless_stable_tgnklq_catalog TO \`<service-principal-client-id>\`;
GRANT USE SCHEMA ON SCHEMA serverless_stable_tgnklq_catalog.data_collector TO \`<service-principal-client-id>\`;
GRANT SELECT, MODIFY ON SCHEMA serverless_stable_tgnklq_catalog.data_collector TO \`<service-principal-client-id>\`;`}</Code>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Repeat for any additional UC schemas that hold collection record tables.
        </Typography>
      </Section>

      <Section title="3. Grant users access to the app">
        <Typography variant="body2" color="text.secondary">
          <strong>Compute → Apps → your app → Permissions</strong> — add users or groups with{' '}
          <strong>Can use</strong> so they can open the app URL.
        </Typography>
      </Section>

      <Section title="4. App service principal — Can manage (member management)">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          When collection admins add members, the app searches workspace users and grants{' '}
          <strong>Can use</strong> on the app to new members. The app service principal must have{' '}
          <strong>Can manage</strong> on the app itself:
        </Typography>
        <BulletList
          items={[
            <>
              <strong>Compute → Apps → your app → Permissions</strong>
            </>,
            <>Find the app service principal (same client id as above)</>,
            <>Set permission to <strong>Can manage</strong></>,
          ]}
        />
        <Box sx={{ mt: 1.5 }}>
          <Code>{`databricks apps update-permissions data-collector-prod -p fvm --json '{
  "access_control_list": [{
    "service_principal_name": "<service-principal-client-id>",
    "permission_level": "CAN_MANAGE"
  }]
}'`}</Code>
        </Box>
      </Section>

      <Section title="5. Lakebase (optional)">
        <BulletList
          items={[
            'Create a Lakebase Postgres project in the workspace (project data-collector, branch production).',
            'Prod deploy re-attaches the database app resource automatically via scripts/deploy.sh.',
            'Verify in app Settings: Lakebase configured = yes.',
            <>
              If records return <code>permission denied for schema</code> in prod after publishing
              locally, run{' '}
              <code>.venv/bin/python scripts/repair_lakebase_grants.py</code> from a machine with
              Lakebase configured in <code>.env</code>.
            </>,
          ]}
        />
      </Section>
    </>
  );
}

function DeploymentHelp() {
  return (
    <>
      <Section title="Local development">
        <Code>{`cp .env.example .env
# Edit DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID
# Optional: DEV_USER_EMAIL, PGHOST/ENDPOINT_NAME for Lakebase, DATABRICKS_APP_NAME

npm install
PIP_CONFIG_FILE=pip.conf .venv/bin/pip install -r requirements.txt

npm run dev:all    # frontend :5173, API :8000`}</Code>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Set <code>DEV_USER_EMAIL</code> to your workspace email so local collections match prod
          membership. Set <code>DATABRICKS_APP_NAME=data-collector-prod</code> to test member app
          grants locally.
        </Typography>
      </Section>

      <Section title="Deploy to Databricks Apps">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Configure CLI auth (<code>DATABRICKS_CONFIG_PROFILE</code>, typically <code>fvm</code> for
          prod). Run setup first, then:
        </Typography>
        <Code>{`npm run deploy          # dev
npm run deploy:prod     # prod`}</Code>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          <code>scripts/deploy.sh</code> builds the frontend, syncs <code>app.yaml</code> (warehouse
          id and <code>DATABRICKS_APP_NAME</code>), runs{' '}
          <code>databricks bundle deploy</code>, re-attaches the Lakebase database resource on prod,
          and starts the app.
        </Typography>
      </Section>

      <Section title="Post-deploy checklist">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Check</TableCell>
              <TableCell>Expected</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Forms page</TableCell>
              <TableCell>Loads without Internal Server Error (UC grants OK)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Your user</TableCell>
              <TableCell>Can open the app URL (Can use on app)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>App service principal</TableCell>
              <TableCell>Can manage on the app (member search + auto grants)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Settings</TableCell>
              <TableCell>db_status ok; Lakebase configured if using Lakebase collections</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Collection membership</TableCell>
              <TableCell>Your email is a project member for collections you need</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Key environment variables">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Variable</TableCell>
              <TableCell>Purpose</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <code>DATABRICKS_WAREHOUSE_ID</code>
              </TableCell>
              <TableCell>SQL warehouse bound to the app</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code>DATABRICKS_CATALOG</code> / <code>DATABRICKS_SCHEMA</code>
              </TableCell>
              <TableCell>UC metadata location</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code>DATABRICKS_APP_NAME</code>
              </TableCell>
              <TableCell>Deployed app name for member permission grants</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code>DATABRICKS_CONFIG_PROFILE</code>
              </TableCell>
              <TableCell>CLI profile for deploy (prod default: fvm)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code>ENDPOINT_NAME</code> / Lakebase vars
              </TableCell>
              <TableCell>Lakebase Postgres for lakebase collections</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Full reference: <code>README.md</code> and <code>.env.example</code> in the repository.
        </Typography>
      </Section>

      <Section title="Troubleshooting">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Symptom</TableCell>
              <TableCell>Fix</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Internal Server Error on Forms</TableCell>
              <TableCell>UC grants for service principal client id</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Access denied / no forms</TableCell>
              <TableCell>Add user to form Members; grant Can use on app</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Member search fails</TableCell>
              <TableCell>App SP needs Can manage on the app</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Records 500 / permission denied schema</TableCell>
              <TableCell>Run scripts/repair_lakebase_grants.py</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Bundle deploy Terraform error</TableCell>
              <TableCell>Upgrade Databricks CLI or set DATABRICKS_TF_EXEC_PATH</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>
    </>
  );
}

export default function HelpView() {
  const [tab, setTab] = useState<HelpTab>('using');

  return (
    <Box>
      <Typography variant="h4" component="h1" className="page-title" gutterBottom>
        Help
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        How to use Brick Constructor, plus setup and deployment guides for workspace administrators.
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value as HelpTab)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="using" label="Using the app" />
        <Tab value="setup" label="Setup" />
        <Tab value="deployment" label="Deployment" />
      </Tabs>

      {tab === 'using' && <UsingHelp />}
      {tab === 'setup' && <SetupHelp />}
      {tab === 'deployment' && <DeploymentHelp />}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Repository docs:{' '}
        <Link href="https://github.com/dgalluzzo26/data-collector" target="_blank" rel="noopener">
          README.md
        </Link>
        , <code>docs/LAKEBASE.md</code>, <code>docs/PRODUCT_PLAN.md</code>
      </Typography>
    </Box>
  );
}
