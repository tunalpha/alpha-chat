import React from 'react';
import logoSrc from '@/assets/alphachat-logo.png';

export default function ClosingSection({ dict, lang }: { dict: any, lang?: 'en' | 'it' }) {
  return (
    <section className="pb-20 border-t border-white/10 pt-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl md:text-5xl font-serif text-white mb-12">{dict.closing.title}</h2>
        <div className="space-y-6 max-w-2xl mx-auto text-lg text-muted-foreground font-light leading-relaxed">
          {dict.closing.takeaways.map((item: string, i: number) => (
            <p key={i}>{item}</p>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-12 max-w-2xl mx-auto mt-24 p-8 border border-white/10 rounded-2xl bg-white/[0.01]">
        <div>
          <h4 className="text-sm uppercase tracking-widest text-white/50 mb-4">{dict.closing.linksTitle}</h4>
          <ul className="space-y-3">
            <li>
              <a href="https://alphachat.sbs/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors">
                AlphaChat (alphachat.sbs)
              </a>
            </li>
            <li>
              <a href="https://getusda.xyz/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors">
                USDA (getusda.xyz)
              </a>
            </li>
            <li>
              <a href="https://alphabitpay.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors">
                AlphaBit Pay
              </a>
            </li>
          </ul>
        </div>
        
        <div>
          <h4 className="text-sm uppercase tracking-widest text-white/50 mb-4">{dict.closing.contactTitle}</h4>
          <a href="mailto:ufficiostampa.giaquintagroup@gmail.com" className="text-white hover:text-primary transition-colors">
            ufficiostampa.giaquintagroup@gmail.com
          </a>
          
          <div className="mt-8 pt-8 border-t border-white/10">
             <img src={logoSrc} alt="Logo" className="w-10 h-10 opacity-50 grayscale" />
          </div>
        </div>
      </div>
    </section>
  );
}