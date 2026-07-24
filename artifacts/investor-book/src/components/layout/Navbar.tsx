import { Link } from 'wouter';
import { en } from '@/content/en';
import { it } from '@/content/it';
import logoSrc from '@/assets/alphachat-logo.png';

interface NavbarProps {
  lang: 'en' | 'it';
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
  </svg>
);

const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export default function Navbar({ lang, theme, toggleTheme }: NavbarProps) {
  const dict = lang === 'en' ? en : it;
  const base = import.meta.env.BASE_URL;
  const pdfFile = lang === 'en'
    ? `${base}AlphaChat-Investor-Book-EN.pdf`
    : `${base}AlphaChat-Investor-Book-IT.pdf`;
  const pdfName = lang === 'en'
    ? 'AlphaChat-Investor-Book-EN.pdf'
    : 'AlphaChat-Investor-Book-IT.pdf';

  return (
    <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-lg border-b border-border/30 no-print transition-all duration-300">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <img src={logoSrc} alt="AlphaChat" className="w-8 h-8 opacity-90" />
          <span className="font-serif font-medium text-lg tracking-tight hidden sm:block">AlphaChat</span>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3 ml-auto">

          {/* Language toggle */}
          <div className="flex bg-muted/20 p-1 rounded-full border border-border/30 text-xs font-medium">
            <Link
              href="/en"
              className={`px-3 py-1.5 rounded-full transition-all ${lang === 'en' ? 'bg-primary text-white shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {dict.nav.readEn}
            </Link>
            <Link
              href="/it"
              className={`px-3 py-1.5 rounded-full transition-all ${lang === 'it' ? 'bg-primary text-white shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {dict.nav.readIt}
            </Link>
          </div>

          {/* Light/dark toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="w-9 h-9 rounded-full flex items-center justify-center border border-border/30 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* PDF download — visible on all screen sizes */}
          <a
            href={pdfFile}
            download={pdfName}
            className="flex items-center gap-2 px-3 py-2 sm:px-4 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-all"
          >
            <DownloadIcon />
            <span>{dict.nav.download}</span>
          </a>

          {/* Contact */}
          <a
            href="mailto:ufficiostampa.giaquintagroup@gmail.com"
            className="hidden md:flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {dict.nav.contact}
          </a>
        </div>
      </div>
    </nav>
  );
}
