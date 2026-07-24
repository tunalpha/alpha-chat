import React from 'react';

export default function PaymentSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="p-8 md:p-12 border border-primary/20 bg-primary/[0.02] rounded-3xl relative overflow-hidden">
        {/* Decorative glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[80px] rounded-full pointer-events-none" />
        
        <div className="relative z-10">
          <h2 className="text-4xl md:text-5xl font-serif text-white mb-4">{dict.paymentLayer.title}</h2>
          <p className="text-xl text-primary mb-8 font-light">{dict.paymentLayer.subtitle}</p>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mb-16">
            {dict.paymentLayer.desc}
          </p>

          <div className="grid sm:grid-cols-2 gap-8">
            {dict.paymentLayer.features.map((feat: any, i: number) => (
              <div key={i} className="bg-background/50 border border-white/5 p-6 rounded-2xl backdrop-blur-sm">
                <div className="w-2 h-2 rounded-full bg-primary mb-4 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
                <h3 className="text-white font-medium mb-2">{feat.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}