import React from 'react';

const stateColors: Record<string, string> = {
  awaiting_deposit:  'bg-slate-500/15 border-slate-500/30 text-slate-300',
  deposit_detected:  'bg-blue-500/15 border-blue-500/30 text-blue-300',
  releasing:         'bg-yellow-500/15 border-yellow-500/30 text-yellow-300',
  released:          'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  refunded:          'bg-red-500/15 border-red-500/30 text-red-300',
  waiting_for_gas:   'bg-orange-500/15 border-orange-500/30 text-orange-300',
};

const stateArrow = ['awaiting_deposit','deposit_detected','releasing','released'];

export default function MultiChainSection({ dict }: { dict: any }) {
  const d = dict.multiChain;

  return (
    <section className="relative">
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{d.title}</h2>
      </div>

      <p className="text-2xl md:text-3xl text-foreground/90 font-light mb-8 max-w-3xl leading-snug">
        {d.subtitle}
      </p>
      <p className="text-base text-muted-foreground leading-relaxed max-w-2xl mb-14 border-l-2 border-primary/40 pl-5">
        {d.desc}
      </p>

      {/* State machine diagram */}
      <div className="mb-14">
        <h3 className="text-xs uppercase tracking-[0.2em] text-primary/60 font-semibold mb-6">
          State Machine
        </h3>

        {/* Main flow (linear) */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-0 mb-6 flex-wrap">
          {stateArrow.map((key, i) => {
            const s = d.stateMachine.find((x: any) => x.state === key);
            if (!s) return null;
            return (
              <React.Fragment key={key}>
                <div className={`rounded-xl border px-4 py-3 text-center min-w-[130px] ${stateColors[key]}`}>
                  <div className="font-mono text-[10px] uppercase tracking-widest mb-1 opacity-70">{s.state.replace(/_/g,' ')}</div>
                </div>
                {i < stateArrow.length - 1 && (
                  <div className="hidden md:flex items-center px-2 text-primary/40 text-lg">→</div>
                )}
                {i < stateArrow.length - 1 && (
                  <div className="md:hidden w-px h-4 bg-primary/30 mx-auto" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* All states with description */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {d.stateMachine.map((s: any, i: number) => (
            <div key={i} className={`rounded-xl border px-4 py-3 ${stateColors[s.state] ?? 'bg-muted/10 border-border text-foreground'}`}>
              <div className="font-mono text-[10px] uppercase tracking-widest mb-1.5 opacity-70">{s.state.replace(/_/g,' ')}</div>
              <p className="text-xs leading-relaxed opacity-80">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Feature cards */}
      <h3 className="text-xs uppercase tracking-[0.2em] text-primary/60 font-semibold mb-5">
        {d.featuresTitle}
      </h3>
      <div className="grid sm:grid-cols-2 gap-5">
        {d.features.map((feat: any, i: number) => (
          <div
            key={i}
            className="bg-muted/10 border border-border rounded-2xl p-6 hover:border-primary/30 hover:bg-primary/5 transition-all duration-300 group"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
                <span className="text-primary font-mono font-bold text-xs">0{i + 1}</span>
              </div>
              <h4 className="text-foreground font-semibold text-sm group-hover:text-primary transition-colors">{feat.title}</h4>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
          </div>
        ))}
      </div>

      {/* Bottom strip */}
      <div className="mt-10 pt-8 border-t border-border flex flex-wrap gap-5 text-xs text-muted-foreground font-mono uppercase tracking-widest">
        <span>Polygon PoS</span>
        <span>Ethereum L1</span>
        <span>BSC</span>
        <span>Bitcoin UTXO</span>
        <span>PSBT</span>
        <span>Atomic Lock</span>
        <span>Anti-Replay</span>
        <span>CoinGecko Real-time Fee</span>
      </div>
    </section>
  );
}
