import React from 'react';
import logoSrc from '@/assets/alphachat-logo.png';

export default function EcosystemSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif text-white">{dict.ecosystem.title}</h2>
        <p className="text-xl text-primary font-light">{dict.ecosystem.subtitle}</p>
        <p className="text-lg text-muted-foreground font-light max-w-2xl mx-auto mt-4">
          {dict.ecosystem.desc}
        </p>
      </div>

      <div className="mt-16 relative">
        {/* Value Chain Diagram (Pure HTML/CSS) */}
        <div className="flex flex-col md:flex-row items-stretch justify-between gap-4 md:gap-2">
          
          <div className="flex-1 w-full bg-white/5 border border-white/10 p-6 rounded-2xl text-center relative z-10">
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="text-sm font-medium text-white">{dict.ecosystem.labels.user}</div>
          </div>

          <div className="hidden md:flex items-center justify-center text-primary/50">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>

          <div className="flex-1 w-full bg-primary/20 border border-primary/50 p-6 rounded-2xl text-center relative z-10 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
              <img src={logoSrc} alt="Logo" className="w-6 h-6" />
            </div>
            <div className="text-sm font-medium text-primary-foreground">{dict.ecosystem.labels.alphaChat}</div>
          </div>

          <div className="hidden md:flex items-center justify-center text-primary/50">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>

          <div className="flex-1 w-full bg-white/5 border border-white/10 p-6 rounded-2xl text-center relative z-10">
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3">
              <span className="font-serif font-bold text-white">$$</span>
            </div>
            <div className="text-sm font-medium text-white">{dict.ecosystem.labels.usda}</div>
          </div>

          <div className="hidden md:flex items-center justify-center text-primary/50">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>

          <div className="flex-1 w-full bg-white/5 border border-white/10 p-6 rounded-2xl text-center relative z-10">
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <div className="text-sm font-medium text-white">{dict.ecosystem.labels.alphaBitPay}</div>
          </div>

          <div className="hidden md:flex items-center justify-center text-primary/50">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>

          <div className="flex-1 w-full bg-white/5 border border-white/10 p-6 rounded-2xl text-center relative z-10">
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div className="text-sm font-medium text-white">{dict.ecosystem.labels.merchants}</div>
          </div>

        </div>

        {/* Connecting line for mobile */}
        <div className="md:hidden absolute top-0 bottom-0 left-1/2 w-px bg-white/10 -translate-x-1/2 z-0" />
      </div>
    </section>
  );
}