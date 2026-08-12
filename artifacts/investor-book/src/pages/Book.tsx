import React from 'react';
import Navbar from '@/components/layout/Navbar';
import { en } from '@/content/en';
import { it } from '@/content/it';

import CoverSection from '@/components/sections/CoverSection';
import FounderSection from '@/components/sections/FounderSection';
import LetterSection from '@/components/sections/LetterSection';
import StorySection from '@/components/sections/StorySection';
import ProductSection from '@/components/sections/ProductSection';
import KpiSection from '@/components/sections/KpiSection';
import HeroPrivateSection from '@/components/sections/HeroPrivateSection';
import SecurityDeepDiveSection from '@/components/sections/SecurityDeepDiveSection';
import WalletDeepDiveSection from '@/components/sections/WalletDeepDiveSection';
import PaymentSection from '@/components/sections/PaymentSection';
import MultiChainSection from '@/components/sections/MultiChainSection';
import HeroPaymentSection from '@/components/sections/HeroPaymentSection';
import HeroTransferSection from '@/components/sections/HeroTransferSection';
import EcosystemSection from '@/components/sections/EcosystemSection';
import ArchitectureSection from '@/components/sections/ArchitectureSection';
import CompetitiveSection from '@/components/sections/CompetitiveSection';
import BusinessModelSection from '@/components/sections/BusinessModelSection';
import HeroMerchantSection from '@/components/sections/HeroMerchantSection';
import MarketSection from '@/components/sections/MarketSection';
import SwotSection from '@/components/sections/SwotSection';
import RoadmapSection from '@/components/sections/RoadmapSection';
import HeroWalletSection from '@/components/sections/HeroWalletSection';
import ClosingSection from '@/components/sections/ClosingSection';

interface BookProps {
  lang: 'en' | 'it';
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export default function Book({ lang, theme, toggleTheme }: BookProps) {
  const dict = lang === 'en' ? en : it;

  React.useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className="min-h-screen text-foreground selection:bg-primary/30">
      <Navbar lang={lang} theme={theme} toggleTheme={toggleTheme} />

      <main className="pb-32">
        {/* ── Cover ── */}
        <CoverSection dict={dict} />

        {/* ── Narrative foundation ── */}
        <div className="max-w-4xl mx-auto px-6 space-y-32 md:space-y-48 mt-32 md:mt-48">
          <FounderSection dict={dict} />
          <LetterSection dict={dict} />
          <StorySection dict={dict} />
          <ProductSection dict={dict} />
          <KpiSection dict={dict} />
        </div>

        {/* ── Hero 1: Private Conversations ── */}
        <div className="mt-32 md:mt-48">
          <HeroPrivateSection dict={dict} />
        </div>

        {/* ── Security Deep Dive ── */}
        <div className="max-w-4xl mx-auto px-6 mt-32 md:mt-48">
          <SecurityDeepDiveSection dict={dict} />
        </div>

        {/* ── Alpha Wallet (full-bleed dark card) ── */}
        <div className="max-w-4xl mx-auto px-6 mt-32 md:mt-48">
          <WalletDeepDiveSection dict={dict} />
        </div>

        {/* ── Hero 5: Wallet (phone mockup interlude) ── */}
        <div className="mt-32 md:mt-48">
          <HeroWalletSection dict={dict} />
        </div>

        {/* ── Payment layer ── */}
        <div className="max-w-4xl mx-auto px-6 mt-32 md:mt-48">
          <PaymentSection dict={dict} />
        </div>

        {/* ── Hero 2: USDA payment ── */}
        <div className="mt-32 md:mt-48">
          <HeroPaymentSection dict={dict} />
        </div>

        {/* ── Multi-Chain Engine ── */}
        <div className="max-w-4xl mx-auto px-6 mt-32 md:mt-48">
          <MultiChainSection dict={dict} />
        </div>

        {/* ── Hero 3: Transfer ── */}
        <HeroTransferSection dict={dict} />

        {/* ── Architecture & Competitive ── */}
        <div className="max-w-4xl mx-auto px-6 space-y-32 md:space-y-48 mt-32 md:mt-48">
          <EcosystemSection dict={dict} />
          <ArchitectureSection dict={dict} />
          <CompetitiveSection dict={dict} />
          <BusinessModelSection dict={dict} />
        </div>

        {/* ── Hero 4: Merchant flow ── */}
        <div className="mt-32 md:mt-48">
          <HeroMerchantSection dict={dict} />
        </div>

        {/* ── Market & Strategy ── */}
        <div className="max-w-4xl mx-auto px-6 space-y-32 md:space-y-48 mt-32 md:mt-48">
          <MarketSection dict={dict} />
          <SwotSection dict={dict} />
          <RoadmapSection dict={dict} />
        </div>

        {/* ── Closing ── */}
        <div className="max-w-4xl mx-auto px-6 mt-32 md:mt-48">
          <ClosingSection dict={dict} />
        </div>
      </main>
    </div>
  );
}
