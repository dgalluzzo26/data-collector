import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import PersonIcon from '@mui/icons-material/Person';
import { defaultBrandLogos } from '../../lib/brandingLogos';

interface DhsSiteHeaderProps {
  appTitle?: string;
  agencyName?: string;
  logoUrl?: string | null;
  tagline?: string;
  showSeal?: boolean;
  actions?: ReactNode;
  userLabel?: string;
}

export default function DhsSiteHeader({
  appTitle = 'Data Collector',
  agencyName = 'Databricks',
  logoUrl = null,
  tagline,
  showSeal = false,
  actions,
  userLabel,
}: DhsSiteHeaderProps) {
  const fallbackLogo = defaultBrandLogos(agencyName).icon;

  return (
    <header className="dhs-site-header">
      <div className="dhs-site-header__inner">
        <RouterLink className="dhs-site-header__logo-link" to="/" title={`${agencyName} — ${appTitle}`}>
          {(showSeal || logoUrl) && (
            <img
              src={logoUrl || fallbackLogo}
              alt=""
              className="dhs-site-header__seal"
            />
          )}
          <div className="dhs-site-header__titles">
            <span className="dhs-site-header__agency">{agencyName}</span>
            <span className="dhs-site-header__app">{appTitle}</span>
          </div>
        </RouterLink>
        {tagline && (
          <p className="dhs-site-header__tagline dhs-site-header__tagline--side">{tagline}</p>
        )}
        {(actions || userLabel) && (
          <div className="dhs-site-header__end">
            {actions && <div className="dhs-site-header__actions">{actions}</div>}
            {userLabel && (
              <div className="dhs-site-header__user" title={userLabel}>
                <PersonIcon sx={{ fontSize: '1.1rem' }} aria-hidden />
                <span className="dhs-site-header__user-name">{userLabel}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
