import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import DashboardIcon from '@mui/icons-material/Dashboard';
import StorageIcon from '@mui/icons-material/Storage';
import SettingsIcon from '@mui/icons-material/Settings';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PersonIcon from '@mui/icons-material/Person';
import ApiIcon from '@mui/icons-material/Api';
import DhsSiteHeader from '../brand/DhsSiteHeader';
import StatusBar from '../common/StatusBar';
import { useBranding } from '../../branding/BrandingProvider';
import { defaultBrandLogos, isDhsAgency } from '../../lib/brandingLogos';
import { useContentTheme } from '../../hooks/useContentTheme';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import './AppShell.css';

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  match: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: <DashboardIcon fontSize="small" />,
    match: (p) => p === '/',
  },
  {
    path: '/collections',
    label: 'Forms',
    icon: <StorageIcon fontSize="small" />,
    match: (p) => p.startsWith('/collections'),
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: <SettingsIcon fontSize="small" />,
    match: (p) => p === '/settings',
  },
  {
    path: '/help',
    label: 'Help',
    icon: <HelpOutlineIcon fontSize="small" />,
    match: (p) => p === '/help',
  },
];

function resolveHeader(pathname: string) {
  if (pathname.includes('/data')) {
    return {
      title: 'Data entry',
      tagline: 'View and manage form records',
    };
  }
  if (pathname.match(/^\/collections\/[^/]+$/)) {
    return {
      title: 'Form workspace',
      tagline: 'Design forms, manage members, and edit records',
    };
  }
  if (pathname.startsWith('/collections')) {
    return {
      title: 'Forms',
      tagline: 'Browse and manage data collection forms',
    };
  }
  if (pathname === '/settings') {
    return { title: 'Settings', tagline: 'Databricks workspace and connection configuration' };
  }
  if (pathname === '/help') {
    return { title: 'Help', tagline: 'How to use Brick Constructor' };
  }
  return {
    title: 'Brick Constructor',
    tagline: 'Ingest, validate, and manage enterprise data forms',
  };
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { branding } = useBranding();
  const brandLogos = defaultBrandLogos(branding.agency_name);
  const { isContentDark, toggleContentTheme } = useContentTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const header = resolveHeader(location.pathname);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toolbarActions = useMemo(() => {
    if (location.pathname === '/') {
      return (
        <>
          <Button variant="outlined" size="small" startIcon={<HelpOutlineIcon />} onClick={() => navigate('/help')}>
            Help
          </Button>
          <Button variant="contained" size="small" startIcon={<StorageIcon />} onClick={() => navigate('/collections')}>
            Forms
          </Button>
        </>
      );
    }
    if (location.pathname.startsWith('/collections')) {
      return (
        <Button variant="outlined" size="small" startIcon={<ApiIcon />} href="/docs" target="_blank" rel="noopener noreferrer">
          API Docs
        </Button>
      );
    }
    return (
      <Button variant="contained" size="small" startIcon={<DashboardIcon />} onClick={() => navigate('/')}>
        Dashboard
      </Button>
    );
  }, [location.pathname, navigate]);

  return (
    <div className="app-root">
      <div
        className={['app-layout', sidebarOpen ? 'sidebar-mobile-open' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {!sidebarOpen && (
          <IconButton className="mobile-menu-btn" aria-label="Open menu" onClick={() => setSidebarOpen(true)}>
            <MenuIcon />
          </IconButton>
        )}

        {sidebarOpen && (
          <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
        )}

        <nav
          className={['sidebar', sidebarCollapsed ? 'collapsed' : '', sidebarOpen ? 'mobile-open' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <div className="sidebar-header">
            <button
              type="button"
              className="brand"
              title={`${branding.app_title} home`}
              onClick={() => {
                navigate('/');
                setSidebarOpen(false);
              }}
            >
              {branding.logo_data_url ? (
                <img
                  src={branding.logo_data_url}
                  alt={branding.agency_name}
                  className={sidebarCollapsed ? 'brand-seal' : 'brand-wordmark'}
                  style={sidebarCollapsed ? { width: 40, height: 40, objectFit: 'contain' } : { maxHeight: 40, width: 'auto' }}
                />
              ) : sidebarCollapsed ? (
                <img src={brandLogos.icon} alt={branding.agency_name} className="brand-seal" width={40} height={40} />
              ) : (
                <img src={brandLogos.wordmark} alt={branding.agency_name} className="brand-wordmark" />
              )}
            </button>
            <div className="sidebar-header-actions">
              <IconButton className="sidebar-icon-btn collapse-btn" size="small" aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'} onClick={() => setSidebarCollapsed((v) => !v)}>
                {sidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
              <IconButton className="sidebar-icon-btn close-mobile-btn" size="small" aria-label="Close menu" onClick={() => setSidebarOpen(false)}>
                <CloseIcon />
              </IconButton>
            </div>
          </div>

          {!sidebarCollapsed && <p className="sidebar-app-label">{branding.app_title}</p>}

          <div className="nav-links">
            {NAV_ITEMS.map(({ path, label, icon, match }) => {
              const active = match(location.pathname);
              return (
                <RouterLink
                  key={path}
                  to={path}
                  className={['nav-link', active ? 'active' : ''].filter(Boolean).join(' ')}
                  title={label}
                  onClick={() => setSidebarOpen(false)}
                >
                  {icon}
                  {!sidebarCollapsed && <span>{label}</span>}
                </RouterLink>
              );
            })}
          </div>

          <div className="sidebar-footer">
            <button type="button" className="theme-toggle" title={isContentDark ? 'Switch to light content area' : 'Switch to dark content area'} aria-pressed={isContentDark} onClick={toggleContentTheme}>
              {isContentDark ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
              {!sidebarCollapsed && <span>{isContentDark ? 'Light mode' : 'Dark mode'}</span>}
            </button>
            {!sidebarCollapsed && isDhsAgency(branding.agency_name) && (
              <a href="https://www.dhs.gov/" target="_blank" rel="noopener noreferrer" className="dhs-footer-link">
                DHS.gov
                <OpenInNewIcon sx={{ fontSize: '0.65rem' }} />
              </a>
            )}
            {!sidebarCollapsed && branding.agency_name === 'Databricks' && (
              <a href="https://www.databricks.com/" target="_blank" rel="noopener noreferrer" className="dhs-footer-link">
                databricks.com
                <OpenInNewIcon sx={{ fontSize: '0.65rem' }} />
              </a>
            )}
            <div className="user-badge">
              <PersonIcon fontSize="small" />
              {!sidebarCollapsed && <span className="user-email">{user?.display_name || 'Not signed in'}</span>}
            </div>
          </div>
        </nav>

        <main className={['main-content', isContentDark ? 'main-content--dark' : ''].filter(Boolean).join(' ')}>
          <div className="main-toolbar">
            <DhsSiteHeader
              appTitle={header.title}
              tagline={header.tagline}
              agencyName={branding.agency_name}
              logoUrl={branding.logo_data_url}
              actions={toolbarActions}
              userLabel={user?.display_name || user?.email}
            />
          </div>
          <div className={['main-content-inner', isContentDark ? 'content-theme-dark' : ''].filter(Boolean).join(' ')}>
            <StatusBar />
            <div className="main-content-body constrained">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
