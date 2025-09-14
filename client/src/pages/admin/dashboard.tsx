import { useQuery } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin-sidebar";
import type { TenantsResponse, HealthResponse } from "@shared/api-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { 
  Users, 
  Bot, 
  Euro, 
  Phone, 
  Plus, 
  UserPlus, 
  TrendingUp,
  Activity,
  ExternalLink
} from "lucide-react";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  
  const { data: tenants, isLoading: tenantsLoading } = useQuery<TenantsResponse>({
    queryKey: ["/api/tenants"],
    enabled: user?.role === 'platform_admin'
  });

  const { data: healthData } = useQuery<HealthResponse>({
    queryKey: ["/api/health"],
  });

  if (tenantsLoading) {
    return (
      <div className="flex">
        <AdminSidebar />
        <div className="ml-72 flex-1 p-6">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-muted rounded w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-32 bg-muted rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalCustomers = tenants?.length || 0;
  const totalBots = 0; // This would come from a separate API call
  const monthlyRevenue = 24890; // This would be calculated from billing data
  const callMinutes = 89456; // This would come from usage events

  return (
    <div className="flex bg-background min-h-screen">
      <AdminSidebar />
      
      {/* Main Content */}
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
              <p className="text-sm text-muted-foreground">Manage your VoiceAgent platform</p>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => navigate("/")}
                data-testid="button-customer-view"
              >
                <Users className="w-4 h-4 mr-2" />
                View Customer Portal
              </Button>
              <Button onClick={() => navigate("/admin/customers")} data-testid="button-add-customer">
                <Plus className="w-4 h-4 mr-2" />
                Add Customer
              </Button>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="p-6 space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Customers</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-customers">
                      {totalCustomers}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +12%
                  </Badge>
                  <span className="text-xs text-muted-foreground">from last month</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active VoiceBots</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-bots">
                      {totalBots}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <Bot className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +8%
                  </Badge>
                  <span className="text-xs text-muted-foreground">from last month</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Monthly Revenue</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-revenue">
                      €{monthlyRevenue.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Euro className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +18%
                  </Badge>
                  <span className="text-xs text-muted-foreground">from last month</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Call Minutes</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-minutes">
                      {callMinutes.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Phone className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +25%
                  </Badge>
                  <span className="text-xs text-muted-foreground">from last month</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity & Top Customers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest system events and customer activities</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!tenants || tenants.length === 0 ? (
                  <div className="text-center py-8">
                    <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">No recent activity</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Add your first customer to see activity
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <UserPlus className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">Platform initialized</p>
                        <p className="text-xs text-muted-foreground">Ready for customer onboarding</p>
                        <p className="text-xs text-muted-foreground">Just now</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Customers */}
            <Card>
              <CardHeader>
                <CardTitle>Customer Overview</CardTitle>
                <CardDescription>Current customer accounts and status</CardDescription>
              </CardHeader>
              <CardContent>
                {!tenants || tenants.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">No customers yet</p>
                    <Button 
                      variant="outline" 
                      className="mt-4"
                      onClick={() => navigate("/admin/customers")}
                      data-testid="button-add-first-customer"
                    >
                      Add Your First Customer
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {tenants.slice(0, 4).map((tenant: any) => (
                      <div key={tenant.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                            <span className="text-sm font-medium text-primary-foreground">
                              {tenant.name[0]}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{tenant.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Created {new Date(tenant.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge 
                            variant={tenant.status === 'active' ? 'default' : 'secondary'}
                            className={tenant.status === 'active' ? 'bg-green-100 text-green-800' : ''}
                          >
                            {tenant.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* System Status */}
          <Card>
            <CardHeader>
              <CardTitle>System Status</CardTitle>
              <CardDescription>Real-time status of all platform services</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Database</p>
                    <p className="text-xs text-muted-foreground">
                      {healthData?.services?.database || 'Operational'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Redis Cache</p>
                    <p className="text-xs text-muted-foreground">
                      {healthData?.services?.redis || 'Operational'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Twilio API</p>
                    <p className="text-xs text-muted-foreground">Not configured</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Stripe API</p>
                    <p className="text-xs text-muted-foreground">Not configured</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
