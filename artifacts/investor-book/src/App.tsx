import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Book from '@/pages/Book';
import PortalHome from '@/pages/PortalHome';
import TechnologyPage from '@/pages/TechnologyPage';
import SecurityPage from '@/pages/SecurityPage';
import RoadmapPage from '@/pages/RoadmapPage';
import MarketPage from '@/pages/MarketPage';
import TeamPage from '@/pages/TeamPage';
import ContactPage from '@/pages/ContactPage';
import InvestorGate from '@/components/InvestorGate';
import { LanguageProvider } from '@/context/LanguageContext';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';

const queryClient = new QueryClient();

function AppRoutes({ theme, toggleTheme }: { theme: 'dark' | 'light'; toggleTheme: () => void }) {
  return (
    <InvestorGate>
      <Switch>
        {/* Portal root → home */}
        <Route path="/">
          <Redirect to="/home" />
        </Route>

        {/* Portal home dashboard */}
        <Route path="/home" component={PortalHome} />

        {/* Investor Book — kept at /book/:lang and legacy /en /it */}
        <Route path="/book/en" component={() => <Book lang="en" theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/book/it" component={() => <Book lang="it" theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/en"      component={() => <Book lang="en" theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/it"      component={() => <Book lang="it" theme={theme} toggleTheme={toggleTheme} />} />

        {/* Portal sections */}
        <Route path="/technology" component={TechnologyPage} />
        <Route path="/security"   component={SecurityPage} />
        <Route path="/roadmap"    component={RoadmapPage} />
        <Route path="/market"     component={MarketPage} />
        <Route path="/team"       component={TeamPage} />
        <Route path="/contact"    component={ContactPage} />

        <Route component={NotFound} />
      </Switch>
    </InvestorGate>
  );
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('ib-theme') as 'dark' | 'light') ?? 'dark'; }
    catch { return 'dark'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') { root.classList.add('light'); root.classList.remove('dark'); }
    else { root.classList.remove('light'); root.classList.add('dark'); }
    try { localStorage.setItem('ib-theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LanguageProvider>
          {/* InvestorGate è DENTRO WouterRouter per poter usare useLocation */}
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AppRoutes theme={theme} toggleTheme={toggleTheme} />
          </WouterRouter>
          <Toaster />
        </LanguageProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
