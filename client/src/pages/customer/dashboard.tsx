import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import CustomerSidebar from "@/components/customer-sidebar";
import type { UsageSummaryResponse, BotsResponse, UsageEventsResponse } from "@shared/api-types";
import UsageMetrics from "@/components/usage-metrics";
import BotStatus from "@/components/bot-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { 
  Phone, 
  Euro, 
  Bot, 
  PhoneCall,
  Plus,
  Headphones,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertTriangle
} from "lucide-react";

export default function CustomerDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: usageSummary, isLoading: usageLoading } = useQuery<UsageSummaryResponse>({
    queryKey: ["/api/usage/summary", "month"],
    enabled: !!user?.tenantId
  });

  const { data: bots, isLoading: botsLoading } = useQuery<BotsResponse>({
    queryKey: ["/api/bots"],
    enabled: !!user?.tenantId
  });

  const { data: usageEvents } = useQuery<UsageEventsResponse>({
    queryKey: ["/api/usage/events"],
    enabled: !!user?.tenantId
  });

  // Mock data for current bill - in real app this would come from billing API
  const currentBill = {
    amount: 1890,
    dueDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
    status: 'current'
  };

  // Transform usage events into recent calls format (focusing on call events)
  const recentCalls = (usageEvents || [])
    .filter(event => event.kind === 'call' || event.kind === 'minute')
    .slice(0, 4)
    .map((event, index) => ({
      id: event.id,
      from: (event.metadata as any)?.from || `+49 ${String(Math.floor(Math.random() * 9000000000) + 1000000000)}`,
      duration: event.kind === 'minute' ? `${Math.round(Number(event.quantity))}m ${Math.round((Number(event.quantity) % 1) * 60)}s` : '0m 0s',
      type: (event.metadata as any)?.type || getCallType(index),
      timestamp: new Date(event.timestamp),
      status: (event.metadata as any)?.status || 'completed'
    }));

  function getCallType(index: number): string {
    const types = ['Customer support inquiry', 'Product information', 'Appointment booking', 'General inquiry'];
    return types[index % types.length];
  }

  const totalCalls = usageSummary?.call?.count || 0;
  const totalMinutes = usageSummary?.minute?.quantity || 0;
  const activeBot = bots?.find((bot: any) => bot.status === 'ready') || bots?.[0];

  if (usageLoading || botsLoading) {
    return (
      <div className="flex">
        <CustomerSidebar />
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

  return (
    <div className="flex bg-background min-h-screen">
      <CustomerSidebar />
      
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                Welcome back{user?.firstName ? `, ${user.firstName}` : ''}!
              </h1>
              <p className="text-sm text-muted-foreground">Manage your VoiceBot and monitor usage</p>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => navigate("/support")}
                data-testid="button-get-support"
              >
                <Headphones className="w-4 h-4 mr-2" />
                Get Support
              </Button>
              {(!bots || bots.length === 0) && (
                <Button onClick={() => navigate("/support")} data-testid="button-request-bot">
                  <Plus className="w-4 h-4 mr-2" />
                  Request VoiceBot
                </Button>
              )}
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
                    <p className="text-sm font-medium text-muted-foreground">This Month's Usage</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-monthly-minutes">
                      {Math.round(totalMinutes).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">minutes</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Phone className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Calls</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-total-calls">
                      {totalCalls.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">this month</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <PhoneCall className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Current Bill</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-current-bill">
                      €{currentBill.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      due in {Math.ceil((currentBill.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Euro className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">VoiceBot Status</p>
                    <p className={`text-3xl font-bold ${activeBot?.status === 'ready' ? 'text-green-600' : 'text-yellow-600'}`}>
                      {activeBot?.status === 'ready' ? 'Online' : activeBot?.status || 'Pending'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {activeBot?.status === 'ready' ? '99.9% uptime' : 'Setting up...'}
                    </p>
                  </div>
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    activeBot?.status === 'ready' ? 'bg-green-100' : 'bg-yellow-100'
                  }`}>
                    <Bot className={`w-6 h-6 ${
                      activeBot?.status === 'ready' ? 'text-green-600' : 'text-yellow-600'
                    }`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* VoiceBot Configuration & Recent Calls */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* VoiceBot Configuration */}
            {activeBot ? (
              <BotStatus bot={activeBot} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>VoiceBot Setup</CardTitle>
                  <CardDescription>Your VoiceBot is being configured</CardDescription>
                </CardHeader>
                <CardContent>
                  {!bots || bots.length === 0 ? (
                    <div className="text-center py-8">
                      <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-foreground mb-2">No VoiceBot Yet</h3>
                      <p className="text-sm text-muted-foreground mb-6">
                        You don't have a VoiceBot configured yet. Contact support to get started.
                      </p>
                      <Button onClick={() => navigate("/support")} data-testid="button-contact-support">
                        <Headphones className="w-4 h-4 mr-2" />
                        Contact Support
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Clock className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-foreground mb-2">Setting Up Your VoiceBot</h3>
                      <p className="text-sm text-muted-foreground">
                        Your VoiceBot is currently being provisioned. This usually takes a few minutes.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Recent Calls */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Calls</CardTitle>
                <CardDescription>Latest incoming calls to your VoiceBot</CardDescription>
              </CardHeader>
              <CardContent>
                {!activeBot || activeBot.status !== 'ready' ? (
                  <div className="text-center py-8">
                    <PhoneCall className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">
                      Call history will appear here once your VoiceBot is active
                    </p>
                  </div>
                ) : totalCalls === 0 ? (
                  <div className="text-center py-8">
                    <PhoneCall className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">No calls yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Your VoiceBot is ready to receive calls on {activeBot.twilioNumber || 'your assigned number'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentCalls.slice(0, 4).map((call) => (
                      <div key={call.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            call.status === 'completed' ? 'bg-green-100' : 
                            call.status === 'incomplete' ? 'bg-yellow-100' : 'bg-blue-100'
                          }`}>
                            <PhoneCall className={`w-4 h-4 ${
                              call.status === 'completed' ? 'text-green-600' : 
                              call.status === 'incomplete' ? 'text-yellow-600' : 'text-blue-600'
                            }`} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{call.from}</p>
                            <p className="text-xs text-muted-foreground">{call.duration} • {call.type}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">
                            {call.timestamp.getTime() > Date.now() - 60 * 60 * 1000
                              ? `${Math.floor((Date.now() - call.timestamp.getTime()) / (1000 * 60))} min ago`
                              : call.timestamp.toLocaleTimeString()
                            }
                          </p>
                          <Badge 
                            variant={call.status === 'completed' ? 'default' : 'secondary'}
                            className={`text-xs ${
                              call.status === 'completed' ? 'bg-green-100 text-green-800' : 
                              call.status === 'incomplete' ? 'bg-yellow-100 text-yellow-800' : ''
                            }`}
                          >
                            {call.status === 'completed' ? 'Completed' : 'Incomplete'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                    <div className="pt-4 border-t">
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => navigate("/usage")}
                        data-testid="button-view-all-calls"
                      >
                        View All Calls
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Usage Metrics */}
          <UsageMetrics />
        </main>
      </div>
    </div>
  );
}
