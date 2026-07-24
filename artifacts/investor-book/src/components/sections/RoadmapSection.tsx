import React from 'react';

const statusConfig: Record<string, { dot: string; ring: string; lineColor: string; badge?: string }> = {
  complete: {
    dot: 'bg-primary shadow-[0_0_12px_rgba(168,85,247,0.9)]',
    ring: 'ring-2 ring-primary/30',
    lineColor: 'bg-primary/60',
  },
  active: {
    dot: 'bg-primary animate-pulse shadow-[0_0_16px_rgba(168,85,247,1)]',
    ring: 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background',
    lineColor: 'bg-primary/30',
    badge: 'In Progress',
  },
  upcoming: {
    dot: 'bg-muted-foreground/25 border border-border',
    ring: '',
    lineColor: 'bg-border',
  },
};

export default function RoadmapSection({ dict }: { dict: any }) {
  const phases = dict.roadmap.phases;
  const isIT = dict.nav?.download === 'Scarica PDF';

  return (
    <section>
      <div className="text-center mb-16 space-y-3">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{dict.roadmap.title}</h2>
        {dict.roadmap.subtitle && (
          <p className="text-xl text-primary font-light">{dict.roadmap.subtitle}</p>
        )}
      </div>

      {/* Phases */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 md:left-7 top-0 bottom-0 w-px bg-gradient-to-b from-primary/60 via-primary/20 to-transparent" />

        <div className="space-y-10">
          {phases.map((phase: any, i: number) => {
            const status: string = phase.status ?? (i === 0 ? 'complete' : 'upcoming');
            const cfg = statusConfig[status] ?? statusConfig.upcoming;
            const isComplete = status === 'complete';
            const isActive = status === 'active';

            return (
              <div key={i} className="relative pl-14 md:pl-20">
                {/* Dot */}
                <div className={`absolute left-3 md:left-5 top-1.5 w-4 h-4 rounded-full ${cfg.dot} ${cfg.ring} flex items-center justify-center`}>
                  {isComplete && (
                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                  )}
                </div>

                <div className={`rounded-2xl border p-6 transition-all duration-300 ${
                  isComplete
                    ? 'border-primary/25 bg-primary/5'
                    : isActive
                    ? 'border-primary/40 bg-primary/8 shadow-[0_0_30px_rgba(168,85,247,0.1)]'
                    : 'border-border bg-muted/5'
                }`}>
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <h3 className={`text-lg font-semibold ${isComplete || isActive ? 'text-primary' : 'text-foreground'}`}>
                      {phase.name}
                    </h3>
                    {cfg.badge && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-primary/20 text-primary border border-primary/30 animate-pulse">
                        {cfg.badge}
                      </span>
                    )}
                    {isComplete && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                        {isIT ? 'Completato' : 'Complete'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl">
                    {phase.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
