import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppShell } from '@/components/layout/AppShell';

import Login          from '@/pages/login';
import ForgotPassword from '@/pages/forgot-password';
import ResetPassword  from '@/pages/reset-password';
import Dashboard from '@/pages/dashboard';
import Growth from '@/pages/growth';
import SecurityFeatures from '@/pages/security-features';
import SystemHealth from '@/pages/system-health';
import Storage from '@/pages/storage';
import SOC from '@/pages/soc';
import UsersPage from '@/pages/users';
import Devices from '@/pages/devices';
import Audit from '@/pages/audit';
import Diagnostics from '@/pages/diagnostics';
import R2Monitor from '@/pages/r2-monitor';
import CallMonitor from '@/pages/call-monitor';
import GasStationMonitor from '@/pages/gas-station';
import EmailSettings from '@/pages/email-settings';
import InvestorAccess from '@/pages/investor-access';
import AccessLogPage from '@/pages/access-log';
import PerformancePage from '@/pages/performance';
import MultichainMonitor from '@/pages/multichain-monitor';
import BitcoinOps from '@/pages/bitcoin-ops';
import FeeConfig from '@/pages/fee-config';
import RevenueMonitor from '@/pages/revenue-monitor';
import AlphaWalletFee     from '@/pages/alpha-wallet-fee';
import AlphaWalletMonitor from '@/pages/alpha-wallet-monitor';
import SparkLightningFee  from '@/pages/spark-lightning-fee';
import SparkMonitor      from '@/pages/spark-monitor';
import SwapMonitor       from '@/pages/swap-monitor';
import SwapRevenue       from '@/pages/swap-revenue';
import SwapFeeConfig     from '@/pages/swap-fee-config';

const queryClient = new QueryClient();

function ProtectedRoutes() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/growth" component={Growth} />
        <Route path="/security-features" component={SecurityFeatures} />
        <Route path="/system-health" component={SystemHealth} />
        <Route path="/storage" component={Storage} />
        <Route path="/soc" component={SOC} />
        <Route path="/users" component={UsersPage} />
        <Route path="/devices" component={Devices} />
        <Route path="/audit" component={Audit} />
        <Route path="/diagnostics" component={Diagnostics} />
        <Route path="/r2-monitor" component={R2Monitor} />
        <Route path="/call-monitor" component={CallMonitor} />
        <Route path="/gas-station" component={GasStationMonitor} />
        <Route path="/email-settings" component={EmailSettings} />
        <Route path="/investor-access" component={InvestorAccess} />
        <Route path="/multichain-monitor" component={MultichainMonitor} />
        <Route path="/bitcoin-ops" component={BitcoinOps} />
        <Route path="/fee-config" component={FeeConfig} />
        <Route path="/revenue-monitor" component={RevenueMonitor} />
        <Route path="/alpha-wallet-fee"     component={AlphaWalletFee}     />
        <Route path="/alpha-wallet-monitor" component={AlphaWalletMonitor} />
        <Route path="/spark-lightning-fee" component={SparkLightningFee} />
        <Route path="/spark-monitor"       component={SparkMonitor} />
        <Route path="/swap-monitor"        component={SwapMonitor}    />
        <Route path="/swap-revenue"        component={SwapRevenue}    />
        <Route path="/swap-fee-config"     component={SwapFeeConfig}  />
        <Route path="/access-log" component={AccessLogPage} />
        <Route path="/performance" component={PerformancePage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login"            component={Login}          />
      <Route path="/forgot-password"  component={ForgotPassword} />
      <Route path="/reset-password"   component={ResetPassword}  />
      <Route path="/.*" component={ProtectedRoutes} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
