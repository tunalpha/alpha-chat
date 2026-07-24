/**
 * PortalLayout — wrapper per tutte le pagine del portale investitori.
 */
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';

interface PortalLayoutProps {
  children: React.ReactNode;
  investorName?: string;
  sessionExpiry?: string;
}

const navLinks = [
  { href: '/home',       label: 'Home',          icon: '🏠', highlight: false },
  { href: '/book/en',    label: 'Investor Book',  icon: '📘', highlight: true  },
  { href: '/technology', label: 'Technology',     icon: '⚡', highlight: false },
  { href: '/security',   label: 'Security',       icon: '🔒', highlight: false },
  { href: '/roadmap',    label: 'Roadmap',        icon: '🗺', highlight: false },
  { href: '/market',     label: 'Market',         icon: '📈', highlight: false },
  { href: '/team',       label: 'Team',           icon: '👥', highlight: false },
  { href: '/contact',    label: 'Contact',        icon: '✉',  highlight: false },
];

export default function PortalLayout({ children, investorName, sessionExpiry }: PortalLayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('ib-theme') as 'dark' | 'light') ?? 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') { root.classList.add('ib-light'); root.classList.remove('ib-dark'); }
    else { root.classList.add('ib-dark'); root.classList.remove('ib-light'); }
    try { localStorage.setItem('ib-theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const handleLogout = () => {
    try { sessionStorage.removeItem('ib_secure_session'); } catch {}
    window.location.reload();
  };

  const expiry = sessionExpiry ? new Date(sessionExpiry) : null;
  const expiryLabel = expiry
    ? (expiry.getFullYear() > 2090 ? 'No expiry' : expiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))
    : '—';

  const isLight = theme === 'light';

  return (
    <div className={`portal-root${isLight ? ' portal-light' : ''}`}>
      {/* Topnav */}
      <nav className="portal-nav">
        <div className="portal-nav-inner">
          {/* Logo */}
          <Link href="/home" className="portal-logo">
            <span className="portal-logo-alpha">α</span>
            <div className="portal-logo-titles">
              <span className="portal-logo-text">AlphaChat</span>
              <span className="portal-logo-subtitle">Confidential Investor Portal</span>
            </div>
            <span className="portal-logo-vdr">VDR</span>
          </Link>

          {/* Desktop links */}
          <div className="portal-links">
            {navLinks.map(l => (
              <Link key={l.href} href={l.href}
                className={`portal-link${location === l.href ? ' portal-link-active' : ''}${l.highlight ? ' portal-link-book' : ''}`}>
                {l.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="portal-nav-right">
            {/* Theme toggle */}
            <button
              className="portal-theme-btn"
              onClick={toggleTheme}
              title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {isLight ? '🌙' : '☀️'}
            </button>

            <div className="portal-session-badge">
              <span className="portal-session-dot" />
              <span className="portal-session-label">
                {investorName ? investorName : 'Secure Session'}
              </span>
            </div>
            <button className="portal-logout-btn" onClick={handleLogout} title="Secure Logout">
              ⎋
            </button>
            {/* Hamburger */}
            <button className="portal-hamburger" onClick={() => setMenuOpen(v => !v)}>
              <span /><span /><span />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="portal-mobile-menu">
            {navLinks.map(l => (
              <Link key={l.href} href={l.href}
                className={`portal-mobile-link${location === l.href ? ' active' : ''}${l.highlight ? ' portal-mobile-link-book' : ''}`}
                onClick={() => setMenuOpen(false)}>
                <span>{l.icon}</span> {l.label}
              </Link>
            ))}
            <div className="portal-mobile-session">
              <span className="portal-mobile-session-key">Authorized until</span>
              <span className="portal-mobile-session-val">{expiryLabel}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="portal-mobile-theme" onClick={toggleTheme}>
                {isLight ? '🌙 Dark Mode' : '☀️ Light Mode'}
              </button>
              <button className="portal-mobile-logout" onClick={handleLogout}>
                🔒 Secure Logout
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Content */}
      <main className="portal-content">
        {children}
      </main>

      {/* Footer */}
      <footer className="portal-footer">
        <div className="portal-footer-inner">
          <div className="portal-footer-left">
            <span className="portal-logo-alpha" style={{ fontSize: 16 }}>α</span>
            <span className="portal-footer-name">AlphaChat · Confidential Investor Data Room</span>
          </div>
          <div className="portal-footer-right">
            <span className="portal-footer-badge">🔒 Encrypted · Monitored · Confidential</span>
            <span className="portal-footer-expiry">Authorized until: {expiryLabel}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
