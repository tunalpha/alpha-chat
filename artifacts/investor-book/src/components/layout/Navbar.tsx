import { Link } from 'wouter';
import { en } from '@/content/en';
import { it } from '@/content/it';
import logoSrc from '@/assets/alphachat-logo.png';

export default function Navbar({ lang }: { lang: 'en' | 'it' }) {
  const dict = lang === 'en' ? en : it;

  return (
    <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-lg border-b border-white/5 no-print transition-all duration-300">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logoSrc} alt="AlphaChat" className="w-8 h-8 opacity-90" />
          <span className="font-serif font-medium text-lg tracking-tight">AlphaChat</span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex bg-white/5 p-1 rounded-full border border-white/10 text-xs font-medium">
            <Link 
              href="/en" 
              className={`px-3 py-1.5 rounded-full transition-all ${lang === 'en' ? 'bg-primary text-white shadow-lg' : 'text-muted-foreground hover:text-white'}`}
            >
              {dict.nav.readEn}
            </Link>
            <Link 
              href="/it" 
              className={`px-3 py-1.5 rounded-full transition-all ${lang === 'it' ? 'bg-primary text-white shadow-lg' : 'text-muted-foreground hover:text-white'}`}
            >
              {dict.nav.readIt}
            </Link>
          </div>
          
          <a 
            href="mailto:ufficiostampa.giaquintagroup@gmail.com"
            className="hidden md:flex items-center text-sm font-medium text-muted-foreground hover:text-white transition-colors"
          >
            {dict.nav.contact}
          </a>
        </div>
      </div>
    </nav>
  );
}