import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "./lib/protected-route";
import { Redirect } from "wouter";
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
import FlowBuilder from "@/pages/customer/flow-builder";
import DemoSetup from "@/pages/demo-setup";

function RoleBasedRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  // Redirect based on user role
  switch (user.role) {
    case 'platform_admin':
    case 'support':
      return <Redirect to="/admin" />;
    case 'customer_admin':
    case 'customer_user':
      return <Redirect to="/dashboard" />;
    default:
      return <Redirect to="/admin" />; // Fallback to admin for unknown roles
  }
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      {!isAuthenticated ? (
        <>
          {/* Landing page for logged out users */}
          <Route path="/" component={AuthPage} />
          {/* Demo setup (public access) */}
          <Route path="/demo" component={DemoSetup} />
          <Route component={AuthPage} />
        </>
      ) : (
        <>
          {/* Admin routes */}
          <ProtectedRoute path="/admin" component={AdminDashboard} roles={['platform_admin']} />
          <ProtectedRoute path="/admin/customers" component={AdminCustomers} roles={['platform_admin']} />
          <ProtectedRoute path="/admin/bots" component={AdminBots} roles={['platform_admin']} />
          <ProtectedRoute path="/admin/billing" component={AdminBilling} roles={['platform_admin']} />
          <ProtectedRoute path="/admin/packages" component={PackageManagement} roles={['platform_admin']} />
          <ProtectedRoute path="/admin/support" component={AdminSupport} roles={['platform_admin', 'support']} />
          <ProtectedRoute path="/admin/settings" component={AdminSettings} roles={['platform_admin']} />
          
          {/* Home page - smart redirect based on role */}
          <Route path="/">
            <RoleBasedRedirect />
          </Route>
          
          {/* Customer routes */}
          <ProtectedRoute path="/dashboard" component={CustomerDashboard} roles={['customer_admin', 'customer_user']} />
          <ProtectedRoute path="/flows" component={FlowBuilder} roles={['customer_admin', 'customer_user']} />
          <ProtectedRoute path="/usage" component={CustomerUsage} roles={['customer_admin', 'customer_user']} />
          <ProtectedRoute path="/billing" component={CustomerBilling} roles={['customer_admin', 'customer_user']} />
          <ProtectedRoute path="/support" component={CustomerSupport} roles={['customer_admin', 'customer_user']} />
          
          {/* Fallback to 404 */}
          <Route component={NotFound} />
        </>
      )}
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
