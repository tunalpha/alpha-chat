import React from 'react';
import logoSrc from '@/assets/alphachat-logo.png';

export default function CoverSection({ dict }: { dict: any }) {
  return (
    <section className="relative h-screen min-h-[800px] flex flex-col items-center justify-center text-center overflow-hidden">
      {/* Multi-layer background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-primary/25 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-violet-500/10 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/3 w-[300px] h-[300px] bg-pink-500/10 blur-[80px] rounded-full pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <img
          src={logoSrc}
          alt="AlphaChat Logo"
          className="w-36 h-36 md:w-44 md:h-44 drop-shadow-[0_0_40px_rgba(168,85,247,0.6)]"
        />

        <div className="space-y-5">
          {/* Badge — large & prominent */}
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-5 py-2 backdrop-blur-md">
            <span className="flex w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
            <span className="text-base font-semibold text-primary tracking-widest uppercase">{dict.cover.badge}</span>
          </div>

          <h1 className="text-7xl md:text-9xl font-serif tracking-tight text-foreground drop-shadow-[0_0_60px_rgba(168,85,247,0.3)]">
            {dict.cover.title}
          </h1>
        </div>

        <p className="max-w-xl text-xl md:text-2xl text-muted-foreground font-light tracking-wide pt-8 border-t border-border/50">
          {dict.cover.subtitle}
        </p>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />
    </section>
  );
}
