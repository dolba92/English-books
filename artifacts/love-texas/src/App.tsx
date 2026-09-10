import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { ReaderSettingsProvider } from '@/contexts/ReaderSettingsContext';

// Pages
import { LibraryPage } from '@/pages/LibraryPage';
import { ReaderPage } from '@/pages/ReaderPage';
import { DictionaryPage } from '@/pages/DictionaryPage';
import { StatsPage } from '@/pages/StatsPage';
import { SettingsPage } from '@/pages/SettingsPage';

const queryClient = new QueryClient();

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={LibraryPage} />
        <Route path="/reader/:id" component={ReaderPage} />
        <Route path="/dictionary" component={DictionaryPage} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReaderSettingsProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ReaderSettingsProvider>
    </QueryClientProvider>
  );
}

export default App;
