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

type Lang = 'en' | 'it';

const T = {
  en: {
    subtitle: 'Confidential Investor Portal',
    home:     'Home',
    book:     'Investor Book',
    tech:     'Technology',
    security: 'Security',
    roadmap:  'Roadmap',
    market:   'Market',
    team:     'Team',
    contact:  'Contact',
    secureSession: 'Secure Session',
    authorizedUntil: 'Authorized until',
    noExpiry: 'No expiry',
    secureLogout: 'Secure Logout',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    confidential: '🔒 Encrypted · Monitored · Confidential',
    dataRoom: 'AlphaChat · Confidential Investor Data Room',
  },
  it: {
    subtitle: 'Portale Investitori Riservato',
    home:     'Home',
    book:     'Investor Book',
    tech:     'Tecnologia',
    security: 'Sicurezza',
    roadmap:  'Roadmap',
    market:   'Mercato',
    team:     'Team',
    contact:  'Contatti',
    secureSession: 'Sessione Sicura',
    authorizedUntil: 'Autorizzato fino al',
    noExpiry: 'Nessuna scadenza',
    secureLogout: 'Logout Sicuro',
    darkMode: 'Modalità Scura',
    lightMode: 'Modalità Chiara',
    confidential: '🔒 Cifrato · Monitorato · Riservato',
    dataRoom: 'AlphaChat · Data Room Investitori Riservata',
  },
};

export default function PortalLayout({ children, investorName, sessionExpiry }: PortalLayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('ib-theme') as 'dark' | 'light') ?? 'dark'; } catch { return 'dark'; }
  });
  const [lang, setLang] = useState<Lang>(() => {
    try { return (localStorage.getItem('ib-lang') as Lang) ?? 'en'; } catch { return 'en'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') { root.classList.add('ib-light'); root.classList.remove('ib-dark'); }
    else { root.classList.add('ib-dark'); root.classList.remove('ib-light'); }
    try { localStorage.setItem('ib-theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  const toggleLang  = () => {
    const next = lang === 'en' ? 'it' : 'en';
    setLang(next);
    try { localStorage.setItem('ib-lang', next); } catch {}
  };

  const t = T[lang];

  const navLinks = [
    { href: '/home',       label: t.home,     icon: '🏠', highlight: false },
    { href: `/book/${lang}`,label: t.book,    icon: '📘', highlight: true  },
    { href: '/technology', label: t.tech,     icon: '⚡', highlight: false },
    { href: '/security',   label: t.security, icon: '🔒', highlight: false },
    { href: '/roadmap',    label: t.roadmap,  icon: '🗺', highlight: false },
    { href: '/market',     label: t.market,   icon: '📈', highlight: false },
    { href: '/team',       label: t.team,     icon: '👥', highlight: false },
    { href: '/contact',    label: t.contact,  icon: '✉',  highlight: false },
  ];

  const handleLogout = () => {
    try { sessionStorage.removeItem('ib_secure_session'); } catch {}
    window.location.reload();
  };

  const expiry = sessionExpiry ? new Date(sessionExpiry) : null;
  const expiryLabel = expiry
    ? (expiry.getFullYear() > 2090 ? t.noExpiry : expiry.toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))
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
              <span className="portal-logo-subtitle">{t.subtitle}</span>
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
            {/* Language toggle */}
            <button className="portal-lang-btn" onClick={toggleLang} title="Switch language">
              {lang === 'en' ? '🇮🇹' : '🇬🇧'}
            </button>

            {/* Theme toggle */}
            <button className="portal-theme-btn" onClick={toggleTheme}
              title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}>
              {isLight ? '🌙' : '☀️'}
            </button>

            <div className="portal-session-badge">
              <span className="portal-session-dot" />
              <span className="portal-session-label">
                {investorName ? investorName : t.secureSession}
              </span>
            </div>
            <button className="portal-logout-btn" onClick={handleLogout} title={t.secureLogout}>
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
              <span className="portal-mobile-session-key">{t.authorizedUntil}</span>
              <span className="portal-mobile-session-val">{expiryLabel}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="portal-mobile-theme" onClick={toggleLang}>
                {lang === 'en' ? '🇮🇹 Italiano' : '🇬🇧 English'}
              </button>
              <button className="portal-mobile-theme" onClick={toggleTheme}>
                {isLight ? '🌙' : '☀️'} {isLight ? (lang === 'it' ? 'Scuro' : 'Dark') : (lang === 'it' ? 'Chiaro' : 'Light')}
              </button>
              <button className="portal-mobile-logout" onClick={handleLogout}>
                🔒 {t.secureLogout}
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
