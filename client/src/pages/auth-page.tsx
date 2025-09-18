import { useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Shield, Users, BarChart } from "lucide-react";

export default function AuthPage() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      if (user.role === 'platform_admin') {
        navigate("/admin");
      } else {
        navigate("/");
      }
    }
  }, [user, navigate]);

  const handleLogin = () => {
    // Redirect to Replit Auth login
    window.location.assign("/api/login");
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left side - Auth forms */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-primary-foreground" />
            </div>
            <h2 className="text-3xl font-bold text-foreground">{t('welcome')} VoiceAgent</h2>
            <p className="mt-2 text-muted-foreground">
              {t('platformDescription')}
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-center">{t('signIn')}</CardTitle>
              <CardDescription className="text-center">
                Sign in with your Replit account to access the VoiceAgent platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleLogin}
                className="w-full"
                size="lg"
                data-testid="button-login-replit"
              >
                <Bot className="w-4 h-4 mr-2" />
                Log in with Replit
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right side - Features showcase */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col lg:justify-center lg:px-8 lg:py-12 bg-muted/30">
        <div className="mx-auto max-w-lg">
          <h3 className="text-2xl font-bold text-foreground mb-8">
            {t('powerfulFeatures')}
          </h3>
          
          <div className="space-y-6">
            <div className="flex items-start space-x-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-1">
                  {t('smartVoiceBots')}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {t('createIntelligentBots')}
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <BarChart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-1">
                  {t('detailedAnalytics')}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {t('trackPerformance')}
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-1">
                  {t('enterpriseSecurity')}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {t('bankGradeSecurity')}
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-1">
                  {t('teamCollaboration')}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {t('workTogether')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}