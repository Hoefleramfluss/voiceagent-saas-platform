import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { UsageSummaryResponse } from "@shared/api-types";
import CustomerSidebar from "@/components/customer-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const [timeFilter, setTimeFilter] = useState("all");

  const { data: usageSummary } = useQuery<UsageSummaryResponse>({
    queryKey: ["/api/usage/summary", "month"],
    enabled: !!user?.tenantId
  });

  // Mock billing data - in real app this would come from billing API
  const billingData = {
    currentBalance: 0,
    nextBillAmount: 1890,
    nextBillDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
    paymentMethod: {
      type: 'card',
      last4: '4242',
      brand: 'visa',
      expiryMonth: 12,
      expiryYear: 2026
    },
    invoices: [
      {
        id: 'inv_1234567890',
        amount: 1245.50,
        currency: 'EUR',
        status: 'paid',
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        paidAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        periodStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        stripeUrl: '#'
      },
      {
        id: 'inv_0987654321',
        amount: 987.25,
        currency: 'EUR',
        status: 'paid',
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        dueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        paidAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000),
        periodStart: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        stripeUrl: '#'
      }
    ]
  };

  // Calculate pricing based on usage
  const pricing = {
    callsPerMinute: 0.05, // €0.05 per minute
    sttPerRequest: 0.006, // €0.006 per STT request
    ttsPerChar: 0.00002, // €0.00002 per TTS character
    gptPerToken: 0.000002 // €0.000002 per GPT token
  };

  const currentUsageCost = {
    calls: (usageSummary?.minute?.quantity || 0) * pricing.callsPerMinute,
    stt: (usageSummary?.stt_req?.count || 0) * pricing.sttPerRequest,
    tts: (usageSummary?.tts_char?.quantity || 0) * pricing.ttsPerChar,
    gpt: (usageSummary?.gpt_tokens?.quantity || 0) * pricing.gptPerToken
  };

  const totalCurrentCost = Object.values(currentUsageCost).reduce((sum, cost) => sum + cost, 0);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'failed':
      case 'overdue':
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
      case 'overdue':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredInvoices = billingData.invoices.filter(invoice => {
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
              <Button variant="outline" data-testid="button-update-payment">
                <CreditCard className="w-4 h-4 mr-2" />
                Update Payment Method
              </Button>
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
                    <p className="text-sm font-medium text-muted-foreground">Current Balance</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="current-balance">
                      €{billingData.currentBalance.toFixed(2)}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Euro className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                    Account in good standing
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Next Bill Amount</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="next-bill-amount">
                      €{billingData.nextBillAmount.toFixed(2)}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <Receipt className="w-6 h-6 text-yellow-600" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-xs text-muted-foreground">
                    Due {billingData.nextBillDate.toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Payment Method</p>
                    <p className="text-lg font-bold text-foreground">
                      **** **** **** {billingData.paymentMethod.last4}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <CreditCard className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-xs text-muted-foreground capitalize">
                    {billingData.paymentMethod.brand} expires {billingData.paymentMethod.expiryMonth}/{billingData.paymentMethod.expiryYear}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Current Month Usage Costs */}
          <Card>
            <CardHeader>
              <CardTitle>Current Month Usage</CardTitle>
              <CardDescription>
                Usage-based costs for the current billing period
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Calendar className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Call Minutes</p>
                      <p className="text-xs text-muted-foreground">
                        {Math.round(usageSummary?.minute?.quantity || 0)} minutes × €{pricing.callsPerMinute}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold">€{currentUsageCost.calls.toFixed(2)}</span>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Speech-to-Text</p>
                      <p className="text-xs text-muted-foreground">
                        {usageSummary?.stt_req?.count || 0} requests × €{pricing.sttPerRequest}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold">€{currentUsageCost.stt.toFixed(2)}</span>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Text-to-Speech</p>
                      <p className="text-xs text-muted-foreground">
                        {Math.round(usageSummary?.tts_char?.quantity || 0)} characters × €{pricing.ttsPerChar}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold">€{currentUsageCost.tts.toFixed(2)}</span>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">AI Processing</p>
                      <p className="text-xs text-muted-foreground">
                        {Math.round(usageSummary?.gpt_tokens?.quantity || 0)} tokens × €{pricing.gptPerToken}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold">€{currentUsageCost.gpt.toFixed(2)}</span>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-foreground">Estimated Total</span>
                    <span className="text-lg font-bold text-foreground" data-testid="estimated-total">
                      €{totalCurrentCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Invoice History */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Invoice History</CardTitle>
                  <CardDescription>
                    Your past invoices and payment history
                  </CardDescription>
                </div>
                <Select value={timeFilter} onValueChange={setTimeFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-invoice-filter">
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
              {filteredInvoices.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No invoices found</h3>
                  <p className="text-sm text-muted-foreground">
                    {billingData.invoices.length === 0
                      ? "You don't have any invoices yet. Invoices will appear here after your first billing cycle."
                      : "No invoices match the selected time filter."
                    }
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((invoice) => (
                      <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                        <TableCell>
                          <span className="font-mono text-sm">{invoice.id}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(invoice.status)}
                            <Badge className={getStatusColor(invoice.status)}>
                              {invoice.status}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold">€{invoice.amount.toFixed(2)}</span>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm text-foreground">
                              {invoice.periodStart.toLocaleDateString()} - {invoice.periodEnd.toLocaleDateString()}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm text-foreground">
                              {invoice.createdAt.toLocaleDateString()}
                            </p>
                            {invoice.paidAt && (
                              <p className="text-xs text-muted-foreground">
                                Paid {invoice.paidAt.toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-view-invoice-${invoice.id}`}
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-download-invoice-${invoice.id}`}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </div>
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
