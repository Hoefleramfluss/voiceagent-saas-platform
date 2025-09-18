import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { UsageSummaryResponse } from "@shared/api-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { 
  BarChart3, 
  TrendingUp, 
  Phone, 
  MessageSquare, 
  Volume2, 
  Zap,
  Calendar,
  ArrowRight
} from "lucide-react";

export default function UsageMetrics() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: usageSummary, isLoading } = useQuery<UsageSummaryResponse>({
    queryKey: ["/api/usage/summary", "month"],
    enabled: !!user?.tenantId
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage Analytics</CardTitle>
          <CardDescription>Your monthly usage breakdown and trends</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-20 bg-muted rounded"></div>
              ))}
            </div>
            <div className="h-32 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const metrics = {
    calls: usageSummary?.call?.count || 0,
    minutes: Math.round(usageSummary?.minute?.quantity || 0),
    sttRequests: usageSummary?.stt_req?.count || 0,
    ttsCharacters: Math.round(usageSummary?.tts_char?.quantity || 0),
    gptTokens: Math.round(usageSummary?.gpt_tokens?.quantity || 0)
  };

  const hasUsage = Object.values(metrics).some(value => value > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Usage Analytics
            </CardTitle>
            <CardDescription>Your monthly usage breakdown and trends</CardDescription>
          </div>
          {hasUsage && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate("/usage")}
              data-testid="button-view-detailed-usage"
            >
              View Details
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!hasUsage ? (
          <div className="text-center py-8">
            <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No usage data yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Usage analytics will appear here once your VoiceBot starts receiving calls.
            </p>
            <Badge variant="secondary" className="text-muted-foreground">
              <Calendar className="w-3 h-3 mr-1" />
              Current month
            </Badge>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Usage Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
                    <Phone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                      Total Calls
                    </p>
                    <p className="text-lg font-bold text-blue-900 dark:text-blue-100" data-testid="usage-metric-calls">
                      {metrics.calls.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-100 dark:bg-green-900/50 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">
                      Minutes
                    </p>
                    <p className="text-lg font-bold text-green-900 dark:text-green-100" data-testid="usage-metric-minutes">
                      {metrics.minutes.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50 dark:bg-purple-950/20 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center">
                    <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide">
                      STT Requests
                    </p>
                    <p className="text-lg font-bold text-purple-900 dark:text-purple-100" data-testid="usage-metric-stt">
                      {metrics.sttRequests.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-orange-50 dark:bg-orange-950/20 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 rounded-lg flex items-center justify-center">
                    <Volume2 className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wide">
                      TTS Chars
                    </p>
                    <p className="text-lg font-bold text-orange-900 dark:text-orange-100" data-testid="usage-metric-tts">
                      {(metrics.ttsCharacters / 1000).toFixed(1)}k
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Usage Summary */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground">This Month's Activity</h4>
                <Badge variant="secondary" className="text-xs">
                  <Calendar className="w-3 h-3 mr-1" />
                  {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </Badge>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Avg call duration:</span>
                  <span className="font-medium text-foreground">
                    {metrics.calls > 0 ? (metrics.minutes / metrics.calls).toFixed(1) : '0'}m
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">AI tokens used:</span>
                  <span className="font-medium text-foreground flex items-center gap-1">
                    <Zap className="w-3 h-3 text-indigo-600" />
                    {(metrics.gptTokens / 1000).toFixed(1)}k
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Efficiency score:</span>
                  <Badge 
                    variant="secondary" 
                    className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                  >
                    {metrics.calls > 0 ? 'Active' : 'Standby'}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
