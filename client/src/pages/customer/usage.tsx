import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { UsageSummaryResponse, BotsResponse } from "@shared/api-types";
import CustomerSidebar from "@/components/customer-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Phone, 
  PhoneCall, 
  MessageSquare, 
  Volume2,
  TrendingUp,
  Calendar,
  BarChart3,
  Download
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CustomerUsage() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState("month");

  const { data: usageSummary, isLoading } = useQuery<UsageSummaryResponse>({
    queryKey: ["/api/usage/summary", timeRange],
    enabled: !!user?.tenantId
  });

  const { data: bots } = useQuery<BotsResponse>({
    queryKey: ["/api/bots"],
    enabled: !!user?.tenantId
  });

  const activeBot = bots?.find((bot: any) => bot.status === 'ready') || bots?.[0];

  // Mock detailed usage data - in real app this would come from API
  const usageBreakdown = {
    calls: usageSummary?.call?.count || 0,
    minutes: Math.round(usageSummary?.minute?.quantity || 0),
    sttRequests: usageSummary?.stt_req?.count || 0,
    ttsCharacters: Math.round(usageSummary?.tts_char?.quantity || 0),
    gptTokens: Math.round(usageSummary?.gpt_tokens?.quantity || 0)
  };

  // Mock recent activity
  const recentActivity = [
    {
      id: '1',
      type: 'call',
      timestamp: new Date(Date.now() - 2 * 60 * 1000),
      details: { from: '+49 176 12345678', duration: '2m 34s' },
      usage: { minutes: 2.6, sttRequests: 12, ttsChars: 145, gptTokens: 89 }
    },
    {
      id: '2',
      type: 'call',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      details: { from: '+49 152 98765432', duration: '1m 12s' },
      usage: { minutes: 1.2, sttRequests: 8, ttsChars: 98, gptTokens: 56 }
    },
    {
      id: '3',
      type: 'call',
      timestamp: new Date(Date.now() - 8 * 60 * 1000),
      details: { from: '+49 171 55555555', duration: '45s' },
      usage: { minutes: 0.8, sttRequests: 3, ttsChars: 42, gptTokens: 23 }
    },
    {
      id: '4',
      type: 'call',
      timestamp: new Date(Date.now() - 12 * 60 * 1000),
      details: { from: '+49 160 77777777', duration: '4m 21s' },
      usage: { minutes: 4.4, sttRequests: 18, ttsChars: 267, gptTokens: 134 }
    }
  ];

  const getTimeRangeLabel = (range: string) => {
    switch (range) {
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'quarter': return 'This Quarter';
      case 'year': return 'This Year';
      default: return 'This Month';
    }
  };

  if (isLoading) {
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
              <h1 className="text-2xl font-semibold text-foreground">Usage & Analytics</h1>
              <p className="text-sm text-muted-foreground">Monitor your VoiceBot usage and performance</p>
            </div>
            <div className="flex items-center gap-4">
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-[180px]" data-testid="select-usage-timerange">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="quarter">This Quarter</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" data-testid="button-export-usage">
                <Download className="w-4 h-4 mr-2" />
                Export Data
              </Button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-6 space-y-6">
          {/* Usage Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Calls</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="usage-total-calls">
                      {usageBreakdown.calls.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <PhoneCall className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-green-600" />
                  <span className="text-xs text-muted-foreground">{getTimeRangeLabel(timeRange)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Call Minutes</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="usage-total-minutes">
                      {usageBreakdown.minutes.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Phone className="w-5 h-5 text-green-600" />
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-xs text-muted-foreground">
                    Avg: {usageBreakdown.calls > 0 ? (usageBreakdown.minutes / usageBreakdown.calls).toFixed(1) : '0'}m per call
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">STT Requests</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="usage-stt-requests">
                      {usageBreakdown.sttRequests.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-purple-600" />
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-xs text-muted-foreground">Speech-to-text</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">TTS Characters</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="usage-tts-chars">
                      {(usageBreakdown.ttsCharacters / 1000).toFixed(1)}k
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <Volume2 className="w-5 h-5 text-orange-600" />
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-xs text-muted-foreground">Text-to-speech</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">AI Tokens</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="usage-gpt-tokens">
                      {(usageBreakdown.gptTokens / 1000).toFixed(1)}k
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-indigo-600" />
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-xs text-muted-foreground">GPT processing</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bot Information */}
          {activeBot && (
            <Card>
              <CardHeader>
                <CardTitle>VoiceBot Information</CardTitle>
                <CardDescription>Current configuration and status</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Bot Name</p>
                    <p className="text-sm font-semibold text-foreground">{activeBot.name}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Phone Number</p>
                    <p className="text-sm font-mono text-foreground">
                      {activeBot.twilioNumber || 'Not assigned'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Language</p>
                    <Badge variant="outline">{activeBot.locale}</Badge>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Status</p>
                    <Badge 
                      className={
                        activeBot.status === 'ready' ? 'bg-green-100 text-green-800' :
                        activeBot.status === 'provisioning' ? 'bg-blue-100 text-blue-800' :
                        activeBot.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }
                    >
                      {activeBot.status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Latest calls and usage details for {getTimeRangeLabel(timeRange).toLowerCase()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usageBreakdown.calls === 0 ? (
                <div className="text-center py-12">
                  <PhoneCall className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No activity yet</h3>
                  <p className="text-sm text-muted-foreground">
                    {!activeBot || activeBot.status !== 'ready' 
                      ? "Usage data will appear here once your VoiceBot is active and receiving calls."
                      : "Your VoiceBot is ready to receive calls. Usage data will appear here after the first call."
                    }
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Caller</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Minutes</TableHead>
                      <TableHead>STT Requests</TableHead>
                      <TableHead>TTS Characters</TableHead>
                      <TableHead>AI Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentActivity.map((activity) => (
                      <TableRow key={activity.id} data-testid={`row-activity-${activity.id}`}>
                        <TableCell>
                          <div>
                            <p className="text-sm text-foreground">
                              {activity.timestamp.toLocaleDateString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {activity.timestamp.toLocaleTimeString()}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">{activity.details.from}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{activity.details.duration}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">{activity.usage.minutes}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{activity.usage.sttRequests}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{activity.usage.ttsChars}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{activity.usage.gptTokens}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
