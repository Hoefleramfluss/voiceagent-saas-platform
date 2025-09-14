import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from 'react-i18next';
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import CustomerSidebar from "@/components/customer-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { 
  Euro, 
  Receipt, 
  CreditCard,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  Crown,
  Zap,
  Users,
  Phone,
  Star,
  Settings,
  TrendingUp
} from "lucide-react";

// Enhanced types for subscription management
interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  monthlyPriceEur: string;
  yearlyPriceEur: string;
  features: string[];
  limits: {
    bots: number;
    calls_per_month: number;
    minutes_per_month: number;
    stt_requests_per_month: number;
    tts_chars_per_month: number;
    gpt_tokens_per_month: number;
  };
  status: string;
  sortOrder: number;
}

interface CurrentSubscription {
  plan: SubscriptionPlan | null;
  billingAccount: {
    tenantId: string;
    stripeCustomerId: string;
    stripeSubscriptionId?: string;
    currentPlanId?: string;
    subscriptionStatus?: string;
    subscriptionStartDate?: string;
    subscriptionEndDate?: string;
    nextBillingDate?: string;
  } | null;
}

interface UsageData {
  totalCostCents: number;
  lineItems: Array<{
    kind: string;
    quantity: number;
    totalAmountCents: number;
    name: string;
  }>;
  periodStart: string;
  periodEnd: string;
}

export default function EnhancedCustomerBilling() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);

  // Get current subscription information
  const { data: subscription, isLoading: loadingSubscription } = useQuery<CurrentSubscription>({
    queryKey: ["/api/subscription/current"],
    enabled: !!user?.tenantId
  });

  // Get available subscription plans
  const { data: availablePlans = [], isLoading: loadingPlans } = useQuery<SubscriptionPlan[]>({
    queryKey: ["/api/subscription/plans"],
    enabled: !!user?.tenantId
  });

  // Get current usage data
  const { data: usageData, isLoading: loadingUsage } = useQuery<UsageData>({
    queryKey: ["/api/billing/current-usage"],
    enabled: !!user?.tenantId
  });

  // Get invoices
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery<any[]>({
    queryKey: ["/api/billing/invoices"],
    enabled: !!user?.tenantId
  });

  // Change subscription plan mutation
  const changeSubscriptionMutation = useMutation({
    mutationFn: async (data: { planId: string; billingCycle: 'monthly' | 'yearly' }) => {
      const response = await apiRequest("POST", "/api/subscription/change", data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Plan Updated",
        description: "Your subscription has been successfully updated."
      });
      setShowPlanDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/current"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update subscription plan",
        variant: "destructive"
      });
    }
  });

  const handlePlanChange = () => {
    if (!selectedPlan) return;
    
    changeSubscriptionMutation.mutate({
      planId: selectedPlan.id,
      billingCycle
    });
  };

  const getPlanPrice = (plan: SubscriptionPlan) => {
    return billingCycle === 'yearly' 
      ? parseFloat(plan.yearlyPriceEur || plan.monthlyPriceEur) / 12
      : parseFloat(plan.monthlyPriceEur);
  };

  const formatUsageLimit = (current: number, limit: number) => {
    if (limit === -1) return "Unlimited";
    return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
  };

  const getUsagePercentage = (current: number, limit: number) => {
    if (limit === -1) return 0;
    return Math.min((current / limit) * 100, 100);
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle className="w-3 h-3 mr-1" />
          Aktiv
        </Badge>;
      case 'paused':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
          <Clock className="w-3 h-3 mr-1" />
          Pausiert
        </Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400">
          <AlertCircle className="w-3 h-3 mr-1" />
          Unbekannt
        </Badge>;
    }
  };

  const getPlanIcon = (planName: string) => {
    if (planName.toLowerCase().includes('enterprise')) return <Crown className="w-5 h-5" />;
    if (planName.toLowerCase().includes('professional')) return <Zap className="w-5 h-5" />;
    return <Star className="w-5 h-5" />;
  };

  return (
    <div className="flex min-h-screen bg-background">
      <CustomerSidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Abrechnung & Abonnements</h1>
            <p className="text-muted-foreground mt-2">Verwalten Sie Ihr Abonnement, überprüfen Sie die Nutzung und zeigen Sie Rechnungen an</p>
          </div>

          {/* Current Subscription Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Aktuelles Abonnement
              </CardTitle>
              <CardDescription>
                Ihr aktiver Abonnementplan und Status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSubscription ? (
                <div className="text-center py-8 text-muted-foreground">Lade Abonnementdaten...</div>
              ) : subscription?.plan ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                        subscription.plan.name.toLowerCase().includes('enterprise') ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' :
                        subscription.plan.name.toLowerCase().includes('professional') ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' :
                        'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                      }`}>
                        {getPlanIcon(subscription.plan.name)}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">{subscription.plan.name}</h3>
                        <p className="text-sm text-muted-foreground">{subscription.plan.description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">€{parseFloat(subscription.plan.monthlyPriceEur).toFixed(2)}</div>
                      <div className="text-sm text-muted-foreground">pro Monat</div>
                      {getStatusBadge(subscription.billingAccount?.subscriptionStatus)}
                    </div>
                  </div>

                  {subscription.billingAccount?.nextBillingDate && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      Nächste Abrechnung: {new Date(subscription.billingAccount.nextBillingDate).toLocaleDateString('de-DE')}
                    </div>
                  )}

                  <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-full">
                        <Settings className="w-4 h-4 mr-2" />
                        Plan ändern
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Abonnementplan wählen</DialogTitle>
                        <DialogDescription>
                          Wählen Sie den Plan, der am besten zu Ihren Bedürfnissen passt
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-6">
                        <div className="flex items-center justify-center gap-4">
                          <Button
                            variant={billingCycle === 'monthly' ? 'default' : 'outline'}
                            onClick={() => setBillingCycle('monthly')}
                          >
                            Monatlich
                          </Button>
                          <Button
                            variant={billingCycle === 'yearly' ? 'default' : 'outline'}
                            onClick={() => setBillingCycle('yearly')}
                          >
                            Jährlich
                            <Badge className="ml-2 bg-green-100 text-green-800">20% Ersparnis</Badge>
                          </Button>
                        </div>

                        <div className="grid md:grid-cols-3 gap-6">
                          {availablePlans.map((plan) => (
                            <Card 
                              key={plan.id} 
                              className={`cursor-pointer transition-all ${
                                selectedPlan?.id === plan.id ? 'border-primary shadow-md' : 'hover:border-primary/50'
                              }`}
                              onClick={() => setSelectedPlan(plan)}
                            >
                              <CardHeader>
                                <div className="flex items-center gap-2">
                                  {getPlanIcon(plan.name)}
                                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                                </div>
                                <CardDescription className="text-sm">{plan.description}</CardDescription>
                                <div className="text-2xl font-bold">
                                  €{getPlanPrice(plan).toFixed(2)}
                                  <span className="text-sm font-normal text-muted-foreground">/Monat</span>
                                </div>
                              </CardHeader>
                              <CardContent>
                                <ul className="space-y-2">
                                  {plan.features.map((feature, index) => (
                                    <li key={index} className="flex items-center gap-2 text-sm">
                                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                                      {feature}
                                    </li>
                                  ))}
                                </ul>
                              </CardContent>
                            </Card>
                          ))}
                        </div>

                        <div className="flex gap-4 pt-4">
                          <Button variant="outline" onClick={() => setShowPlanDialog(false)}>
                            Abbrechen
                          </Button>
                          <Button 
                            onClick={handlePlanChange}
                            disabled={!selectedPlan || changeSubscriptionMutation.isPending}
                          >
                            {changeSubscriptionMutation.isPending ? 'Aktualisiere...' : 'Plan aktualisieren'}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-muted-foreground mb-4">Kein aktives Abonnement</div>
                  <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
                    <DialogTrigger asChild>
                      <Button>Plan auswählen</Button>
                    </DialogTrigger>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Usage Overview */}
          {subscription?.plan && usageData && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Nutzungsübersicht
                </CardTitle>
                <CardDescription>
                  Ihre Nutzung für den aktuellen Abrechnungszeitraum
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        <span className="text-sm font-medium">Anrufe</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatUsageLimit(
                          usageData.lineItems.find(item => item.kind === 'call')?.quantity || 0,
                          subscription.plan?.limits.calls_per_month || 0
                        )}
                      </span>
                    </div>
                    <Progress 
                      value={getUsagePercentage(
                        usageData.lineItems.find(item => item.kind === 'call')?.quantity || 0,
                        subscription.plan?.limits.calls_per_month || 0
                      )} 
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm font-medium">Minuten</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatUsageLimit(
                          usageData.lineItems.find(item => item.kind === 'minute')?.quantity || 0,
                          subscription.plan?.limits.minutes_per_month || 0
                        )}
                      </span>
                    </div>
                    <Progress 
                      value={getUsagePercentage(
                        usageData.lineItems.find(item => item.kind === 'minute')?.quantity || 0,
                        subscription.plan?.limits.minutes_per_month || 0
                      )} 
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        <span className="text-sm font-medium">VoiceBots</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatUsageLimit(1, subscription.plan?.limits.bots || 0)}
                      </span>
                    </div>
                    <Progress 
                      value={getUsagePercentage(1, subscription.plan?.limits.bots || 0)} 
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Current Month Costs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Euro className="w-5 h-5" />
                Aktuelle Kosten
              </CardTitle>
              <CardDescription>
                Kosten für den laufenden Abrechnungszeitraum
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingUsage ? (
                <div className="text-center py-8 text-muted-foreground">Lade Kostendaten...</div>
              ) : usageData ? (
                <div className="space-y-4">
                  <div className="text-3xl font-bold">
                    €{(usageData.totalCostCents / 100).toFixed(2)}
                  </div>
                  
                  {usageData.lineItems.length > 0 && (
                    <div className="space-y-2">
                      {usageData.lineItems.map((item, index) => (
                        <div key={index} className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
                          <div>
                            <span className="font-medium">{item.name}</span>
                            <span className="text-sm text-muted-foreground ml-2">({item.quantity} Einheiten)</span>
                          </div>
                          <span className="font-medium">€{(item.totalAmountCents / 100).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-sm text-muted-foreground">
                    Zeitraum: {new Date(usageData.periodStart).toLocaleDateString('de-DE')} - {new Date(usageData.periodEnd).toLocaleDateString('de-DE')}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">Keine Kostendaten verfügbar</div>
              )}
            </CardContent>
          </Card>

          {/* Invoice History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                Rechnungsverlauf
              </CardTitle>
              <CardDescription>
                Ihre letzten Rechnungen und Zahlungen
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingInvoices ? (
                <div className="text-center py-8 text-muted-foreground">Lade Rechnungen...</div>
              ) : invoices.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Betrag</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(invoices as any[]).slice(0, 10).map((invoice: any) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          {new Date(invoice.createdAt).toLocaleDateString('de-DE')}
                        </TableCell>
                        <TableCell className="font-medium">
                          €{parseFloat(invoice.totalAmount).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {invoice.status === 'paid' && (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Bezahlt
                            </Badge>
                          )}
                          {invoice.status === 'pending' && (
                            <Badge className="bg-yellow-100 text-yellow-800">
                              <Clock className="w-3 h-3 mr-1" />
                              Ausstehend
                            </Badge>
                          )}
                          {invoice.status === 'failed' && (
                            <Badge className="bg-red-100 text-red-800">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Fehlgeschlagen
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm">
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">Keine Rechnungen verfügbar</div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}