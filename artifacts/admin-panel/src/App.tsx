import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppShell } from '@/components/layout/AppShell';

import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Growth from '@/pages/growth';
import SecurityFeatures from '@/pages/security-features';
import SystemHealth from '@/pages/system-health';
import Storage from '@/pages/storage';
import SOC from '@/pages/soc';
import UsersPage from '@/pages/users';
import Devices from '@/pages/devices';
import Audit from '@/pages/audit';

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
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/.*" component={ProtectedRoutes} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
