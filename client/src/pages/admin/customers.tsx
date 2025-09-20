import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin-sidebar";
import AdminGuard from "@/components/AdminGuard";
import type { TenantsResponse } from "@shared/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Building, Calendar, MoreHorizontal } from "lucide-react";

interface CreateTenantData {
  name: string;
  email: string;
  planId: string;
  twilioNumberSid: string;
  retellAgentId?: string;
}

const DEFAULT_BOT_PROMPT =
  "This bot is managed entirely through Retell AI. Configure behaviour, tools and messaging directly within Retell.";
const DEFAULT_BOT_GREETING = "Voice agent managed via Retell AI";

const EMPTY_FORM: CreateTenantData = {
  name: "",
  email: "",
  planId: "",
  twilioNumberSid: "",
  retellAgentId: undefined,
};

function normalizeArray(value: unknown): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data as any[];
    }
    if (Array.isArray(obj.items)) {
      return obj.items as any[];
    }
    if (Array.isArray(obj.agents)) {
      return obj.agents as any[];
    }
  }
  return [];
}

function formatCurrency(value: unknown): string {
  const numeric = typeof value === "string" ? parseFloat(value) : value;
  if (typeof numeric !== "number" || Number.isNaN(numeric)) {
    return "€0.00";
  }
  return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(numeric);
}

function AdminCustomersContent() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTenant, setNewTenant] = useState<CreateTenantData>(EMPTY_FORM);

  const { data: tenants, isLoading } = useQuery<TenantsResponse>({
    queryKey: ["/api/tenants"],
  });

  const { data: plans, isLoading: plansLoading } = useQuery<any[]>({
    queryKey: ["/api/subscription/plans"],
  });

  const { data: twilioNumbers, isLoading: numbersLoading } = useQuery<any[]>({
    queryKey: ["/api/twilio/numbers/existing"],
  });

  const { data: retellAgents, isLoading: retellLoading, isError: retellError } = useQuery<any>({
    queryKey: ["/api/retell/agents"],
  });

  const normalizedPlans = useMemo(() => {
    const entries = normalizeArray(plans);
    return entries.filter((plan) => (plan?.status ?? "active") !== "inactive");
  }, [plans]);

  const normalizedNumbers = useMemo(() => {
    return normalizeArray(twilioNumbers);
  }, [twilioNumbers]);

  const retellOptions = useMemo(() => {
    return normalizeArray(retellAgents)
      .map((agent) => {
        const id = agent?.agent_id ?? agent?.id ?? agent?.agentId ?? agent?.uid;
        if (!id || typeof id !== "string") {
          return null;
        }
        const label =
          agent?.name ??
          agent?.display_name ??
          agent?.agent_name ??
          agent?.label ??
          `Agent ${id}`;
        return { id, label: String(label) };
      })
      .filter(Boolean) as { id: string; label: string }[];
  }, [retellAgents]);

  const createTenantMutation = useMutation({
    mutationFn: async (data: CreateTenantData) => {
      const tenantRes = await apiRequest("POST", "/api/tenants", {
        name: data.name,
        email: data.email,
      });
      const tenant = await tenantRes.json();

      const botPayload: Record<string, unknown> = {
        tenantId: tenant.id,
        name: `${data.name} VoiceBot`,
        locale: "de-AT",
        sttProvider: "google",
        ttsProvider: "elevenlabs",
        greetingMessage: DEFAULT_BOT_GREETING,
        systemPrompt: DEFAULT_BOT_PROMPT,
      };
      if (data.retellAgentId) {
        botPayload.retellAgentId = data.retellAgentId;
      }

      const botRes = await apiRequest("POST", "/api/bots", botPayload);
      const bot = await botRes.json();

      const selectedNumber = normalizedNumbers.find((n) => n?.sid === data.twilioNumberSid);
      if (!selectedNumber) {
        throw new Error("Selected Twilio number is no longer available. Please refresh the list.");
      }

      await apiRequest("POST", `/api/tenants/${tenant.id}/assign-number`, {
        numberSid: selectedNumber.sid,
        phoneNumber: selectedNumber.phoneNumber,
        botId: bot.id,
      });

      const checkoutRes = await apiRequest("POST", `/api/customers/${tenant.id}/stripe/checkout`, {
        planId: data.planId,
      });
      const checkout = await checkoutRes.json();

      const plan = normalizedPlans.find((p) => p?.id === data.planId);

      return {
        tenant,
        checkoutUrl: checkout?.url as string | undefined,
        email: data.email,
        planName: plan?.name ?? "Subscription",
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/twilio/numbers/existing"] });
      setNewTenant(EMPTY_FORM);
      setIsCreateOpen(false);
      toast({
        title: "Customer created",
        description:
          result.checkoutUrl
            ? `Checkout email for ${result.planName} sent to ${result.email}.`
            : `Customer created and checkout initiated.`,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to create customer";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleCreateTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenant.planId || !newTenant.twilioNumberSid) {
      toast({
        title: "Missing information",
        description: "Select a subscription plan and Twilio number before creating the customer.",
        variant: "destructive",
      });
      return;
    }

    createTenantMutation.mutate({
      ...newTenant,
      retellAgentId: newTenant.retellAgentId || undefined,
    });
  };

  const isSubmitting = createTenantMutation.isPending;
  const isFormValid =
    newTenant.name.trim().length > 0 &&
    newTenant.email.trim().length > 0 &&
    newTenant.planId &&
    newTenant.twilioNumberSid &&
    normalizedNumbers.length > 0;

  if (isLoading) {
    return (
      <div className="flex">
        <AdminSidebar />
        <div className="ml-72 flex-1 p-6">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-muted rounded w-1/3"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminGuard>
      <div className="flex bg-background min-h-screen">
      <AdminSidebar />

      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Customers</h1>
              <p className="text-sm text-muted-foreground">Manage customer accounts and tenants</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (!open) {
                setNewTenant(EMPTY_FORM);
              }
            }}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-customer">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Customer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Customer</DialogTitle>
                  <DialogDescription>
                    Create the tenant, assign a Twilio number and trigger the Stripe checkout email.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateTenant} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="tenant-name">Company Name</Label>
                    <Input
                      id="tenant-name"
                      placeholder="Acme Corporation"
                      value={newTenant.name}
                      onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                      required
                      data-testid="input-tenant-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant-email">Contact Email</Label>
                    <Input
                      id="tenant-email"
                      type="email"
                      placeholder="admin@acme.com"
                      value={newTenant.email}
                      onChange={(e) => setNewTenant({ ...newTenant, email: e.target.value })}
                      required
                      data-testid="input-tenant-email"
                    />
                    <p className="text-xs text-muted-foreground">
                      The checkout link will be sent to this address.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Subscription Plan *</Label>
                    <Select
                      value={newTenant.planId}
                      onValueChange={(value) => setNewTenant({ ...newTenant, planId: value })}
                      disabled={plansLoading || normalizedPlans.length === 0}
                    >
                      <SelectTrigger data-testid="select-plan">
                        <SelectValue placeholder={plansLoading ? "Loading plans..." : "Select plan"} />
                      </SelectTrigger>
                      <SelectContent>
                        {normalizedPlans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name} · {formatCurrency(plan.monthlyPriceEur ?? plan.monthlyPrice)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {normalizedPlans.length === 0 && !plansLoading && (
                      <p className="text-xs text-muted-foreground">No active subscription plans available.</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Assign Twilio Number *</Label>
                    <Select
                      value={newTenant.twilioNumberSid}
                      onValueChange={(value) => setNewTenant({ ...newTenant, twilioNumberSid: value })}
                      disabled={numbersLoading || normalizedNumbers.length === 0}
                    >
                      <SelectTrigger data-testid="select-twilio-number">
                        <SelectValue placeholder={numbersLoading ? "Loading numbers..." : "Select Twilio number"} />
                      </SelectTrigger>
                      <SelectContent>
                        {normalizedNumbers.map((number) => (
                          <SelectItem key={number.sid} value={number.sid}>
                            {number.phoneNumber} {number.friendlyName ? `(${number.friendlyName})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {normalizedNumbers.length === 0 && !numbersLoading && (
                      <p className="text-xs text-muted-foreground">
                        No Twilio numbers available. Purchase or import numbers first.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Retell Agent (optional)</Label>
                    <Select
                      value={newTenant.retellAgentId ?? "none"}
                      onValueChange={(value) =>
                        setNewTenant({ ...newTenant, retellAgentId: value === "none" ? undefined : value })
                      }
                      disabled={retellLoading}
                    >
                      <SelectTrigger data-testid="select-retell-agent">
                        <SelectValue placeholder={retellLoading ? "Loading agents..." : "Select Retell agent"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Retell agent</SelectItem>
                        {retellOptions.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {retellError && (
                      <p className="text-xs text-destructive">Failed to load Retell agents. You can assign one later.</p>
                    )}
                    {!retellLoading && !retellError && retellOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">No Retell agents found for the configured account.</p>
                    )}
                  </div>

                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsCreateOpen(false);
                        setNewTenant(EMPTY_FORM);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting || !isFormValid}
                      data-testid="button-create-tenant"
                    >
                      {isSubmitting ? "Creating..." : "Create Customer"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Content */}
        <main className="p-6 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Customers</p>
                    <p className="text-3xl font-bold text-foreground">
                      {tenants?.length || 0}
                    </p>
                  </div>
                  <Users className="w-8 h-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active Customers</p>
                    <p className="text-3xl font-bold text-foreground">
                      {tenants?.filter((t: any) => t.status === "active").length || 0}
                    </p>
                  </div>
                  <Building className="w-8 h-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">This Month</p>
                    <p className="text-3xl font-bold text-foreground">
                      {tenants?.filter((t: any) => {
                        const created = new Date(t.createdAt);
                        const now = new Date();
                        return (
                          created.getMonth() === now.getMonth() &&
                          created.getFullYear() === now.getFullYear()
                        );
                      }).length || 0}
                    </p>
                  </div>
                  <Calendar className="w-8 h-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Customers Table */}
          <Card>
            <CardHeader>
              <CardTitle>All Customers</CardTitle>
              <CardDescription>
                Complete list of customer tenants and their status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!tenants || tenants.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No customers yet</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Get started by adding your first customer to the platform.
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)} data-testid="button-add-first">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Your First Customer
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Stripe Customer</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenants.map((tenant: any) => (
                      <TableRow key={tenant.id} data-testid={`row-tenant-${tenant.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                              <span className="text-sm font-medium text-primary-foreground">
                                {tenant.name[0]}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{tenant.name}</p>
                              <p className="text-sm text-muted-foreground">ID: {tenant.id.slice(0, 8)}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={tenant.status === "active" ? "default" : "secondary"}
                            className={tenant.status === "active" ? "bg-green-100 text-green-800" : ""}
                          >
                            {tenant.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm text-foreground">
                              {new Date(tenant.createdAt).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(tenant.createdAt).toLocaleTimeString()}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {tenant.stripeCustomerId ? (
                            <Badge variant="outline">Connected</Badge>
                          ) : (
                            <Badge variant="secondary">Not connected</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" data-testid={`button-actions-${tenant.id}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
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
    </AdminGuard>
  );
}

export default function AdminCustomers() {
  return <AdminCustomersContent />;
}
