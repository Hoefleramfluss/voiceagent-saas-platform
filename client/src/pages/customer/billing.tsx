import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { 
  CurrentUsageResponse,
  PaymentIntentResponse, 
  PricingTier,
  InvoiceResponse
} from "@shared/api-types";
import CustomerSidebar from "@/components/customer-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StripeProvider } from "@/components/stripe-provider";
import { PaymentForm } from "@/components/payment-form";
import { 
  Euro, 
  Receipt, 
  Download, 
  Eye, 
  CreditCard,
  Calendar,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock
} from "lucide-react";

export default function CustomerBilling() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [timeFilter, setTimeFilter] = useState("all");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentIntentData, setPaymentIntentData] = useState<PaymentIntentResponse | null>(null);

  // Get real usage and cost data from billing API
  const { data: usageAndCosts, isLoading: loadingUsage } = useQuery<CurrentUsageResponse>({
    queryKey: ["/api/billing/current-usage"],
    enabled: !!user?.tenantId
  });

  // Get real invoices from billing API  
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery<InvoiceResponse[]>({
    queryKey: ["/api/billing/invoices"],
    enabled: !!user?.tenantId
  });

  // Get pricing information
  const { data: pricingTiers = [] } = useQuery<PricingTier[]>({
    queryKey: ["/api/billing/pricing"],
    enabled: !!user?.tenantId
  });

  // Create payment intent for current usage
  const createPaymentMutation = useMutation<PaymentIntentResponse>({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/billing/create-payment-intent", {});
      return await response.json();
    },
    onSuccess: (data) => {
      if (data.clientSecret) {
        setPaymentIntentData(data);
        setShowPaymentDialog(true);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Payment Error",
        description: error.message || "Failed to create payment intent",
        variant: "destructive"
      });
    }
  });

  const handlePaymentSuccess = () => {
    setShowPaymentDialog(false);
    setPaymentIntentData(null);
    // Refresh usage and invoices data
    queryClient.invalidateQueries({ queryKey: ["/api/billing/current-usage"] });
    queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices"] });
    toast({
      title: "Payment Successful",
      description: "Your payment has been processed successfully."
    });
  };

  const handlePaymentError = (error: string) => {
    toast({
      title: "Payment Failed", 
      description: error,
      variant: "destructive"
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'failed':
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredInvoices = invoices.filter(invoice => {
    if (timeFilter === 'all') return true;
    
    const invoiceDate = new Date(invoice.createdAt);
    const now = new Date();
    
    switch (timeFilter) {
      case 'month':
        return invoiceDate.getMonth() === now.getMonth() && 
               invoiceDate.getFullYear() === now.getFullYear();
      case 'quarter':
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const invoiceQuarter = Math.floor(invoiceDate.getMonth() / 3);
        return invoiceQuarter === currentQuarter && 
               invoiceDate.getFullYear() === now.getFullYear();
      case 'year':
        return invoiceDate.getFullYear() === now.getFullYear();
      default:
        return true;
    }
  });

  if (loadingUsage || loadingInvoices) {
    return (
      <div className="flex">
        <CustomerSidebar />
        <div className="ml-72 flex-1 p-6">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-muted rounded w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-muted rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentUsage = usageAndCosts?.usage || {};
  const currentCosts = usageAndCosts?.costs || {};
  const totalCurrentCost = usageAndCosts?.totalCost || 0;

  return (
    <div className="flex bg-background min-h-screen">
      <CustomerSidebar />
      
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Billing & Invoices</h1>
              <p className="text-sm text-muted-foreground">Manage your billing information and invoices</p>
            </div>
            <div className="flex items-center gap-4">
              {totalCurrentCost > 0 && (
                <Button 
                  onClick={() => createPaymentMutation.mutate()}
                  disabled={createPaymentMutation.isPending}
                  data-testid="button-pay-now"
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  {createPaymentMutation.isPending ? "Processing..." : `Pay €${totalCurrentCost.toFixed(2)}`}
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-6 space-y-6">
          {/* Billing Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Current Usage Cost</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="current-usage-cost">
                      €{totalCurrentCost.toFixed(2)}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Euro className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <div className="mt-4">
                  {totalCurrentCost > 0 ? (
                    <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">
                      Pending payment
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                      No outstanding charges
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Invoices</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="total-invoices">
                      {invoices.length}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <Receipt className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    {invoices.filter(inv => inv.status === 'paid').length} paid
                  </Badge>
                  <Badge variant="secondary" className="text-yellow-700 bg-yellow-100">
                    {invoices.filter(inv => inv.status === 'pending').length} pending
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">This Month Total</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="month-total">
                      €{invoices
                        .filter(inv => {
                          const now = new Date();
                          const invoiceDate = new Date(inv.createdAt);
                          return invoiceDate.getMonth() === now.getMonth() && 
                                 invoiceDate.getFullYear() === now.getFullYear();
                        })
                        .reduce((sum, inv) => sum + Number(inv.totalAmount), 0)
                        .toFixed(2)}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Current Usage Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Current Usage & Costs</CardTitle>
              <CardDescription>Your usage for this billing period</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {pricingTiers.map((tier: any) => {
                  const usage = currentUsage[tier.kind] || 0;
                  const cost = currentCosts[tier.kind] || 0;
                  return (
                    <div key={tier.kind} className="p-4 border rounded-lg">
                      <div className="text-sm font-medium text-muted-foreground">{tier.name}</div>
                      <div className="text-lg font-bold" data-testid={`usage-${tier.kind}`}>
                        {usage.toLocaleString()} units
                      </div>
                      <div className="text-sm text-green-600" data-testid={`cost-${tier.kind}`}>
                        €{cost.toFixed(4)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        €{tier.ratePerUnit.toFixed(6)} per unit
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Invoice History */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Invoice History</CardTitle>
                  <CardDescription>View and download your past invoices</CardDescription>
                </div>
                <Select value={timeFilter} onValueChange={setTimeFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-time-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="quarter">This Quarter</SelectItem>
                    <SelectItem value="year">This Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No invoices found for the selected time period.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredInvoices.map((invoice: any) => (
                        <TableRow key={invoice.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getStatusIcon(invoice.status)}
                              <div>
                                <div className="font-medium" data-testid={`invoice-id-${invoice.id}`}>
                                  {invoice.id.substring(0, 8)}...
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {new Date(invoice.createdAt).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {new Date(invoice.periodStart).toLocaleDateString()} - {new Date(invoice.periodEnd).toLocaleDateString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={getStatusColor(invoice.status)} data-testid={`invoice-status-${invoice.id}`}>
                              {invoice.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium" data-testid={`invoice-amount-${invoice.id}`}>
                            €{Number(invoice.totalAmount).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {invoice.metadata?.invoice_url && (
                                <Button variant="outline" size="sm" asChild data-testid={`button-view-invoice-${invoice.id}`}>
                                  <a href={invoice.metadata.invoice_url} target="_blank" rel="noopener noreferrer">
                                    <Eye className="w-4 h-4 mr-1" />
                                    View
                                  </a>
                                </Button>
                              )}
                              {invoice.status === 'failed' && (
                                <Button variant="outline" size="sm" data-testid={`button-retry-${invoice.id}`}>
                                  <CreditCard className="w-4 h-4 mr-1" />
                                  Retry
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Payment</DialogTitle>
            <DialogDescription>
              Complete your payment to process your current usage charges.
            </DialogDescription>
          </DialogHeader>
          {paymentIntentData && (
            <StripeProvider clientSecret={paymentIntentData.clientSecret}>
              <PaymentForm
                clientSecret={paymentIntentData.clientSecret}
                amount={paymentIntentData.amount}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            </StripeProvider>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}