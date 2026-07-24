import React from 'react';
import Navbar from '@/components/layout/Navbar';
import { en } from '@/content/en';
import { it } from '@/content/it';

import CoverSection from '@/components/sections/CoverSection';
import FounderSection from '@/components/sections/FounderSection';
import LetterSection from '@/components/sections/LetterSection';
import StorySection from '@/components/sections/StorySection';
import ProductSection from '@/components/sections/ProductSection';
import PaymentSection from '@/components/sections/PaymentSection';
import EcosystemSection from '@/components/sections/EcosystemSection';
import ArchitectureSection from '@/components/sections/ArchitectureSection';
import CompetitiveSection from '@/components/sections/CompetitiveSection';
import BusinessModelSection from '@/components/sections/BusinessModelSection';
import SwotSection from '@/components/sections/SwotSection';
import RoadmapSection from '@/components/sections/RoadmapSection';
import ClosingSection from '@/components/sections/ClosingSection';

export default function Book({ lang }: { lang: 'en' | 'it' }) {
  const dict = lang === 'en' ? en : it;

  React.useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className="min-h-screen text-foreground selection:bg-primary/30">
      <Navbar lang={lang} />
      
      <main className="pb-32">
        <CoverSection dict={dict} />
        <div className="max-w-4xl mx-auto px-6 space-y-32 md:space-y-48">
          <FounderSection dict={dict} />
          <LetterSection dict={dict} />
          <StorySection dict={dict} />
          <ProductSection dict={dict} />
          <PaymentSection dict={dict} />
          <EcosystemSection dict={dict} />
          <ArchitectureSection dict={dict} />
          <CompetitiveSection dict={dict} />
          <BusinessModelSection dict={dict} />
          <SwotSection dict={dict} />
          <RoadmapSection dict={dict} />
          <ClosingSection dict={dict} />
        </div>
      </main>
    </div>
  );
}