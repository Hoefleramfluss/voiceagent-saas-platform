import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin-sidebar";
import type { TenantsResponse, BillingOverviewResponse } from "@shared/api-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Euro, 
  Receipt, 
  TrendingUp, 
  Calendar, 
  CreditCard,
  Download,
  Eye,
  AlertCircle,
  CheckCircle,
  Clock
} from "lucide-react";

export default function AdminBilling() {
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [timeRange, setTimeRange] = useState<string>("month");

  const { data: tenants } = useQuery<TenantsResponse>({
    queryKey: ["/api/tenants"],
  });

  // This would fetch billing data from Stripe
  const { data: billingData, isLoading } = useQuery<BillingOverviewResponse>({
    queryKey: ["/api/billing/overview", timeRange, selectedTenant],
    queryFn: async () => {
      // Mock implementation - in real app this would fetch from Stripe
      await new Promise(resolve => setTimeout(resolve, 1000));
      return {
        totalRevenue: 24890,
        pendingAmount: 3450,
        paidInvoices: 127,
        failedPayments: 3,
        invoices: []
      };
    }
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'failed':
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
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
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

  return (
    <div className="flex bg-background min-h-screen">
      <AdminSidebar />
      
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Billing</h1>
              <p className="text-sm text-muted-foreground">Revenue overview and invoice management</p>
            </div>
            <div className="flex items-center gap-4">
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-[180px]" data-testid="select-time-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="quarter">This Quarter</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                </SelectContent>
              </Select>
              <Button data-testid="button-export-billing">
                <Download className="w-4 h-4 mr-2" />
                Export Data
              </Button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-6 space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-total-revenue">
                      €{billingData?.totalRevenue?.toLocaleString() || '0'}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <Euro className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +18%
                  </Badge>
                  <span className="text-xs text-muted-foreground">from last period</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Pending Amount</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-pending-amount">
                      €{billingData?.pendingAmount?.toLocaleString() || '0'}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <Clock className="w-6 h-6 text-yellow-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-yellow-700 bg-yellow-100">
                    {billingData?.failedPayments || 0} failed
                  </Badge>
                  <span className="text-xs text-muted-foreground">payments pending</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Paid Invoices</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-paid-invoices">
                      {billingData?.paidInvoices || 0}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Receipt className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-green-700 bg-green-100">
                    95.2% success rate
                  </Badge>
                  <span className="text-xs text-muted-foreground">payment rate</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Failed Payments</p>
                    <p className="text-3xl font-bold text-red-600" data-testid="metric-failed-payments">
                      {billingData?.failedPayments || 0}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="secondary" className="text-red-700 bg-red-100">
                    Requires attention
                  </Badge>
                  <span className="text-xs text-muted-foreground">follow up needed</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Customer Filter */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <label htmlFor="filter-customer" className="text-sm font-medium">
                  Filter by Customer:
                </label>
                <Select value={selectedTenant} onValueChange={setSelectedTenant}>
                  <SelectTrigger className="w-[300px]" data-testid="filter-billing-customer">
                    <SelectValue placeholder="All customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All customers</SelectItem>
                    {tenants?.map((tenant: any) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTenant && (
                  <Button
                    variant="outline"
                    onClick={() => setSelectedTenant("")}
                    data-testid="button-clear-filter"
                  >
                    Clear Filter
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Invoices Table */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Invoices</CardTitle>
              <CardDescription>
                Latest billing activity and payment status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!billingData?.invoices || billingData.invoices.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No invoices yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Invoices will appear here as customers use the platform and generate usage.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingData.invoices.map((invoice: any) => (
                      <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                        <TableCell>
                          <span className="font-mono text-sm">{invoice.id}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                              <span className="text-sm font-medium text-primary-foreground">
                                {invoice.customer.name[0]}
                              </span>
                            </div>
                            <span className="font-medium">{invoice.customer.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold">€{invoice.amount.toLocaleString()}</span>
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
                          <span className="text-sm">
                            {new Date(invoice.periodStart).toLocaleDateString()} - {new Date(invoice.periodEnd).toLocaleDateString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {new Date(invoice.dueDate).toLocaleDateString()}
                          </span>
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

          {/* Payment Methods Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Customer payment method distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-5 h-5 text-blue-600" />
                      <span className="text-sm font-medium">Credit Cards</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">87%</span>
                      <div className="w-20 h-2 bg-muted rounded-full">
                        <div className="w-[87%] h-2 bg-blue-600 rounded-full"></div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Euro className="w-5 h-5 text-green-600" />
                      <span className="text-sm font-medium">SEPA Direct Debit</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">13%</span>
                      <div className="w-20 h-2 bg-muted rounded-full">
                        <div className="w-[13%] h-2 bg-green-600 rounded-full"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenue Trends</CardTitle>
                <CardDescription>Monthly recurring revenue growth</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <TrendingUp className="w-12 h-12 text-green-600 mx-auto mb-4" />
                  <p className="text-2xl font-bold text-green-600 mb-2">+18.5%</p>
                  <p className="text-sm text-muted-foreground">
                    Monthly growth compared to last period
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
