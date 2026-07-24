/**
 * PortalLayout — wrapper per tutte le pagine del portale investitori.
 */
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useLang } from '@/context/LanguageContext';
import { nav as T } from '@/lib/i18n';

interface PortalLayoutProps {
  children: React.ReactNode;
  investorName?: string;
  sessionExpiry?: string;
}

export default function PortalLayout({ children, investorName, sessionExpiry }: PortalLayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { lang, toggleLang } = useLang();
  const t = T[lang];

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('ib-theme') as 'dark' | 'light') ?? 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') { root.classList.add('ib-light'); root.classList.remove('ib-dark'); }
    else { root.classList.add('ib-dark'); root.classList.remove('ib-light'); }
    try { localStorage.setItem('ib-theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(th => th === 'dark' ? 'light' : 'dark');

  const navLinks = [
    { href: '/home',         label: t.home,     highlight: false },
    { href: `/book/${lang}`, label: t.book,     highlight: true  },
    { href: '/technology',   label: t.tech,     highlight: false },
    { href: '/security',     label: t.security, highlight: false },
    { href: '/roadmap',      label: t.roadmap,  highlight: false },
    { href: '/market',       label: t.market,   highlight: false },
    { href: '/team',         label: t.team,     highlight: false },
    { href: '/contact',      label: t.contact,  highlight: false },
  ];

  const mobileIcons: Record<string, string> = {
    '/home': '🏠', [`/book/${lang}`]: '📘', '/technology': '⚡',
    '/security': '🔒', '/roadmap': '🗺', '/market': '📈',
    '/team': '👥', '/contact': '✉',
  };

  const handleLogout = () => {
    try { sessionStorage.removeItem('ib_secure_session'); } catch {}
    window.location.reload();
  };

  const expiry = sessionExpiry ? new Date(sessionExpiry) : null;
  const expiryLabel = expiry
    ? (expiry.getFullYear() > 2090
        ? t.noExpiry
        : expiry.toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))
    : '—';

  const isLight = theme === 'light';

  return (
    <div className={`portal-root${isLight ? ' portal-light' : ''}`}>
      {/* Topnav */}
      <nav className="portal-nav">
        <div className="portal-nav-inner">
          {/* Logo */}
          <Link href="/home" className="portal-logo">
            <img
              src={`${import.meta.env.BASE_URL}master-flat.svg`}
              alt="AlphaChat"
              style={{ height: 30, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
            />
            <span className="portal-logo-text">AlphaChat</span>
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

          {/* Right side — hidden on mobile, shown via hamburger */}
          <div className="portal-nav-right">
            <button className="portal-lang-btn" onClick={toggleLang} title="Switch language">
              {lang === 'en' ? '🇮🇹' : '🇬🇧'}
            </button>
            <button className="portal-theme-btn" onClick={toggleTheme}
              title={isLight ? 'Dark mode' : 'Light mode'}>
              {isLight ? '🌙' : '☀️'}
            </button>
            <div className="portal-session-badge">
              <span className="portal-session-dot" />
              <span className="portal-session-label">
                {investorName ?? t.secureSession}
              </span>
            </div>
            <button className="portal-logout-btn" onClick={handleLogout} title={t.secureLogout}>⎋</button>
            {/* Hamburger */}
            <button className="portal-hamburger" onClick={() => setMenuOpen(v => !v)} aria-label="Menu">
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
                <span>{mobileIcons[l.href] ?? '•'}</span> {l.label}
              </Link>
            ))}
            <div className="portal-mobile-session">
              <span className="portal-mobile-session-key">{t.authorizedUntil}</span>
              <span className="portal-mobile-session-val">{expiryLabel}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="portal-mobile-theme" onClick={toggleLang}>
                {lang === 'en' ? '🇮🇹 Italiano' : '🇬🇧 English'}
              </button>
              <button className="portal-mobile-theme" onClick={toggleTheme}>
                {isLight ? '🌙' : '☀️'} {isLight ? t.dark : t.light}
              </button>
              <button className="portal-mobile-logout" onClick={handleLogout}>
                🔒 {t.secureLogout}
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Content */}
      <main className="portal-content">{children}</main>

      {/* Footer */}
      <footer className="portal-footer">
        <div className="portal-footer-inner">
          <div className="portal-footer-left">
            <span className="portal-logo-alpha" style={{ fontSize: 16 }}>α</span>
            <span className="portal-footer-name">{t.dataRoom}</span>
          </div>
          <div className="portal-footer-right">
            <span className="portal-footer-badge">{t.confidential}</span>
            <span className="portal-footer-expiry">{t.authorizedUntil}: {expiryLabel}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
