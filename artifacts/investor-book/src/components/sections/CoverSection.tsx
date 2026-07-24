import React from 'react';
import logoSrc from '@/assets/alphachat-logo.png';

export default function CoverSection({ dict }: { dict: any }) {
  return (
    <section className="relative h-screen min-h-[800px] flex flex-col items-center justify-center text-center overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="relative z-10 flex flex-col items-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <img 
          src={logoSrc}
          alt="AlphaChat Logo" 
          className="w-32 h-32 md:w-40 md:h-40 drop-shadow-[0_0_30px_rgba(168,85,247,0.4)]"
        />
        
        <div className="space-y-4">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-muted-foreground backdrop-blur-md">
            <span className="flex w-2 h-2 rounded-full bg-primary mr-2 animate-pulse" />
            {dict.cover.badge}
          </div>
          
          <h1 className="text-6xl md:text-8xl font-serif tracking-tight text-foreground">
            {dict.cover.title}
          </h1>
        </div>
        
        <p className="max-w-xl text-xl md:text-2xl text-muted-foreground font-light tracking-wide pt-8 border-t border-white/10">
          {dict.cover.subtitle}
        </p>
      </div>
    </section>
  );
}