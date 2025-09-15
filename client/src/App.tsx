import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "./lib/protected-route";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminCustomers from "@/pages/admin/customers";
import AdminBots from "@/pages/admin/bots";
import AdminBilling from "@/pages/admin/billing";
import AdminSupport from "@/pages/admin/support";
import AdminSettings from "@/pages/admin/settings";
import PackageManagement from "@/pages/admin/package-management";
import CustomerDashboard from "@/pages/customer/dashboard";
import CustomerUsage from "@/pages/customer/usage";
import CustomerBilling from "@/pages/customer/billing-enhanced";
import CustomerSupport from "@/pages/customer/support";
import DemoSetup from "@/pages/demo-setup";

function Router() {
  return (
    <Switch>
      {/* Auth page */}
      <Route path="/auth" component={AuthPage} />
      
      {/* Demo setup (public access) */}
      <Route path="/demo" component={DemoSetup} />
      
      {/* Admin routes */}
      <ProtectedRoute path="/admin" component={AdminDashboard} roles={['platform_admin']} />
      <ProtectedRoute path="/admin/customers" component={AdminCustomers} roles={['platform_admin']} />
      <ProtectedRoute path="/admin/bots" component={AdminBots} roles={['platform_admin']} />
      <ProtectedRoute path="/admin/billing" component={AdminBilling} roles={['platform_admin']} />
      <ProtectedRoute path="/admin/packages" component={PackageManagement} roles={['platform_admin']} />
      <ProtectedRoute path="/admin/support" component={AdminSupport} roles={['platform_admin', 'support']} />
      <ProtectedRoute path="/admin/settings" component={AdminSettings} roles={['platform_admin']} />
      
      {/* Customer routes */}
      <ProtectedRoute path="/" component={CustomerDashboard} roles={['customer_admin', 'customer_user']} />
      <ProtectedRoute path="/usage" component={CustomerUsage} roles={['customer_admin', 'customer_user']} />
      <ProtectedRoute path="/billing" component={CustomerBilling} roles={['customer_admin', 'customer_user']} />
      <ProtectedRoute path="/support" component={CustomerSupport} roles={['customer_admin', 'customer_user']} />
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
