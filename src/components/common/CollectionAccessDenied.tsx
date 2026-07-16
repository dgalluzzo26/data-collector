import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

interface CollectionAccessDeniedProps {
  collectionName?: string;
  adminEmails?: string[];
  backTo?: string;
  backLabel?: string;
}

function requestAccessMailto(collectionName: string | undefined, adminEmails: string[]): string {
  const to = adminEmails.join(',');
  const title = collectionName || 'this collection';
  const subject = encodeURIComponent(`Access request: ${title}`);
  const body = encodeURIComponent(
    `Hi,\n\nI'd like access to the "${title}" data collection in Data Collector.\n\nThanks!`,
  );
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

export default function CollectionAccessDenied({
  collectionName,
  adminEmails = [],
  backTo = '/collections',
  backLabel = 'Back to collections',
}: CollectionAccessDeniedProps) {
  const hasAdmins = adminEmails.length > 0;

  return (
    <Box
      sx={{
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 6,
        bgcolor: 'var(--app-chrome-bg, #f8fafc)',
      }}
    >
      <Card
        elevation={0}
        sx={{
          maxWidth: 520,
          width: '100%',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'visible',
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center' }}>
          <Box
            sx={{
              width: 88,
              height: 88,
              mx: 'auto',
              mb: 2.5,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              boxShadow: '0 8px 24px rgba(0, 60, 120, 0.18)',
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 42 }} />
          </Box>

          <Typography variant="h5" component="h1" fontWeight={700} gutterBottom>
            You don&apos;t have access
          </Typography>

          {collectionName && (
            <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1 }}>
              {collectionName}
            </Typography>
          )}

          <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
            This collection is restricted to invited members. Ask a collection admin to add your
            workspace email before you can view or enter data.
          </Typography>

          {hasAdmins ? (
            <Box
              sx={{
                textAlign: 'left',
                bgcolor: 'action.hover',
                borderRadius: 1.5,
                p: 2,
                mb: 3,
              }}
            >
              <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <EmailOutlinedIcon fontSize="small" color="action" />
                Collection admins
              </Typography>
              <Stack spacing={0.5} sx={{ mb: 2 }}>
                {adminEmails.map((email) => (
                  <Link key={email} href={`mailto:${email}`} underline="hover" variant="body2">
                    {email}
                  </Link>
                ))}
              </Stack>
              <Button
                variant="contained"
                size="small"
                startIcon={<EmailOutlinedIcon />}
                href={requestAccessMailto(collectionName, adminEmails)}
                sx={{ textTransform: 'none' }}
              >
                Request access by email
              </Button>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Contact your Data Collector workspace administrator to be added to this collection.
            </Typography>
          )}

          <Button component={RouterLink} to={backTo} variant="outlined">
            {backLabel}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
