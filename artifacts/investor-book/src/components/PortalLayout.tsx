/**
 * PortalLayout — wrapper per tutte le pagine del portale investitori.
 * Mostra la topnav e gestisce la sessione.
 */
import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';

interface PortalLayoutProps {
  children: React.ReactNode;
  lang?: 'en' | 'it';
  investorName?: string;
  sessionExpiry?: string;
}

const navLinks = [
  { href: '/home',     label: 'Home',         icon: '⌂' },
  { href: '/book/en',  label: 'Investor Book', icon: '📄' },
  { href: '/technology', label: 'Technology',  icon: '⚡' },
  { href: '/security', label: 'Security',      icon: '🔒' },
  { href: '/roadmap',  label: 'Roadmap',       icon: '🗺' },
  { href: '/market',   label: 'Market',        icon: '📈' },
  { href: '/team',     label: 'Team',          icon: '👥' },
  { href: '/contact',  label: 'Contact',       icon: '✉' },
];

export default function PortalLayout({ children, investorName, sessionExpiry }: PortalLayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    try { sessionStorage.removeItem('ib_secure_session'); } catch {}
    window.location.reload();
  };

  const expiry = sessionExpiry ? new Date(sessionExpiry) : null;
  const expiryLabel = expiry
    ? (expiry.getFullYear() > 2090 ? 'No expiry' : expiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))
    : '—';

  return (
    <div className="portal-root">
      {/* Topnav */}
      <nav className="portal-nav">
        <div className="portal-nav-inner">
          {/* Logo */}
          <Link href="/home" className="portal-logo">
            <span className="portal-logo-alpha">α</span>
            <span className="portal-logo-text">AlphaChat</span>
            <span className="portal-logo-vdr">VDR</span>
          </Link>

          {/* Desktop links */}
          <div className="portal-links">
            {navLinks.map(l => (
              <Link key={l.href} href={l.href}
                className={`portal-link${location === l.href ? ' portal-link-active' : ''}`}>
                {l.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="portal-nav-right">
            <div className="portal-session-badge">
              <span className="portal-session-dot" />
              <span className="portal-session-label">
                {investorName ? `${investorName}` : 'Secure Session'}
              </span>
            </div>
            <button className="portal-logout-btn" onClick={handleLogout} title="End session">
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
                className={`portal-mobile-link${location === l.href ? ' active' : ''}`}
                onClick={() => setMenuOpen(false)}>
                <span>{l.icon}</span> {l.label}
              </Link>
            ))}
            <div className="portal-mobile-session">
              Session valid until: {expiryLabel}
            </div>
            <button className="portal-mobile-logout" onClick={handleLogout}>
              End Session
            </button>
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
            <span style={{ color: 'rgba(232,232,240,0.3)', fontSize: 12 }}>AlphaChat Investor Data Room</span>
          </div>
          <div className="portal-footer-right">
            <span className="portal-footer-badge">🔒 Encrypted · Monitored · Confidential</span>
            <span className="portal-footer-expiry">Session: {expiryLabel}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
