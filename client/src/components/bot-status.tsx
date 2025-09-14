import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SerializedBot } from "@shared/api-types";
import { 
  Bot, 
  Phone, 
  Globe, 
  MessageSquare, 
  Volume2, 
  Play, 
  Settings, 
  CheckCircle, 
  AlertCircle, 
  Clock,
  Zap,
  RefreshCw
} from "lucide-react";

interface BotStatusProps {
  bot: SerializedBot;
}

export default function BotStatus({ bot }: BotStatusProps) {
  const { toast } = useToast();
  const [isTestingBot, setIsTestingBot] = useState(false);

  const testBotMutation = useMutation({
    mutationFn: async () => {
      // In a real implementation, this would trigger a test call or health check
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      return { success: true };
    },
    onMutate: () => {
      setIsTestingBot(true);
    },
    onSuccess: () => {
      toast({
        title: "VoiceBot test successful",
        description: "Your VoiceBot is responding correctly to test calls.",
      });
    },
    onError: (error) => {
      toast({
        title: "VoiceBot test failed",
        description: error.message || "There was an issue testing your VoiceBot.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsTestingBot(false);
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'provisioning':
        return <Clock className="w-4 h-4 text-blue-600 animate-pulse" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'pending':
      default:
        return <Clock className="w-4 h-4 text-yellow-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'provisioning':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case 'pending':
      default:
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
    }
  };

  const getStatusMessage = (status: string) => {
    switch (status) {
      case 'ready':
        return 'Your VoiceBot is online and ready to receive calls';
      case 'provisioning':
        return 'Setting up your VoiceBot infrastructure...';
      case 'failed':
        return 'VoiceBot setup failed. Contact support for assistance';
      case 'pending':
      default:
        return 'VoiceBot is queued for provisioning';
    }
  };

  const handleTestBot = () => {
    if (bot.status === 'ready') {
      testBotMutation.mutate();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              bot.status === 'ready' ? 'bg-green-100 dark:bg-green-900/20' : 
              bot.status === 'provisioning' ? 'bg-blue-100 dark:bg-blue-900/20' :
              bot.status === 'failed' ? 'bg-red-100 dark:bg-red-900/20' :
              'bg-yellow-100 dark:bg-yellow-900/20'
            }`}>
              <Bot className={`w-5 h-5 ${
                bot.status === 'ready' ? 'text-green-600 dark:text-green-400' :
                bot.status === 'provisioning' ? 'text-blue-600 dark:text-blue-400' :
                bot.status === 'failed' ? 'text-red-600 dark:text-red-400' :
                'text-yellow-600 dark:text-yellow-400'
              }`} />
            </div>
            <div>
              <CardTitle className="text-lg">{bot.name}</CardTitle>
              <CardDescription>VoiceBot Configuration</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon(bot.status)}
            <Badge className={getStatusColor(bot.status)} data-testid="bot-status-badge">
              {bot.status.charAt(0).toUpperCase() + bot.status.slice(1)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Message */}
        <div className={`p-3 rounded-lg border ${
          bot.status === 'ready' ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800' :
          bot.status === 'provisioning' ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800' :
          bot.status === 'failed' ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800' :
          'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800'
        }`}>
          <p className="text-sm text-foreground" data-testid="bot-status-message">
            {getStatusMessage(bot.status)}
          </p>
        </div>

        {/* Configuration Details */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Phone Number</span>
                </div>
                <span className="text-sm font-mono text-foreground" data-testid="bot-phone-number">
                  {bot.twilioNumber || 'Not assigned'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Language</span>
                </div>
                <Badge variant="outline" data-testid="bot-locale">
                  {bot.locale}
                </Badge>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Speech-to-Text</span>
                </div>
                <Badge variant="secondary" className="capitalize" data-testid="bot-stt-provider">
                  {bot.sttProvider}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Text-to-Speech</span>
                </div>
                <Badge variant="secondary" className="capitalize" data-testid="bot-tts-provider">
                  {bot.ttsProvider}
                </Badge>
              </div>
            </div>
          </div>

          {/* Greeting Message */}
          {bot.greetingMessage && (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Greeting Message</span>
                </div>
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-sm text-foreground italic" data-testid="bot-greeting-message">
                    "{bot.greetingMessage}"
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <Separator />
          <div className="flex flex-col sm:flex-row gap-3">
            {bot.status === 'ready' ? (
              <>
                <Button 
                  onClick={handleTestBot}
                  disabled={isTestingBot}
                  className="flex-1"
                  data-testid="button-test-bot"
                >
                  {isTestingBot ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {isTestingBot ? 'Testing...' : 'Test VoiceBot'}
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1"
                  data-testid="button-configure-bot"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Configure
                </Button>
              </>
            ) : bot.status === 'failed' ? (
              <Button 
                variant="outline" 
                className="w-full"
                data-testid="button-retry-provisioning"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry Setup
              </Button>
            ) : (
              <div className="flex items-center justify-center py-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4 animate-pulse" />
                  <span className="text-sm">Setup in progress...</span>
                </div>
              </div>
            )}
          </div>

          {/* Bot Info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center justify-between">
              <span>Created:</span>
              <span>{new Date(bot.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Last updated:</span>
              <span>{new Date(bot.updatedAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Bot ID:</span>
              <span className="font-mono">{bot.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
