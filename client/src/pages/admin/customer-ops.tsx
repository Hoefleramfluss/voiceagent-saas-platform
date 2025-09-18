import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin-sidebar";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Users, 
  Euro, 
  Bot, 
  Clock,
  TrendingUp,
  ExternalLink,
  Rocket,
  Play,
  Edit,
  Eye,
  PhoneCall,
  CreditCard,
  Settings,
  Activity,
  AlertTriangle,
  CheckCircle,
  Plus
} from "lucide-react";

const applyUsageSchema = z.object({
  botId: z.string().uuid(),
  minuteType: z.enum(['voice_bot', 'forwarding']),
  minutesDecimal: z.number().positive(),
  source: z.string().default('manual'),
  periodStart: z.string(),
  periodEnd: z.string()
});

const agentUpdateSchema = z.object({
  systemPrompt: z.string().optional(),
  greetingMessage: z.string().optional(),
  locale: z.string().optional()
});

interface Customer {
  id: string;
  name: string;
  status: string;
  stripeCustomerId?: string;
  billingRunningBalanceCents?: number;
}

interface CustomerBillingOverview {
  success: boolean;
  period: {
    start: string;
    end: string;
    type: string;
  };
  usage: {
    voiceBotMinutes: number;
    forwardingMinutes: number;
    totalMinutes: number;
    estimatedCostCents: number;
  };
  balance: {
    runningBalanceCents: number;
    runningBalanceFormatted: string;
  };
}

interface RetellAgent {
  botId: string;
  retellAgentId: string;
  name: string;
  status: string;
  tenantId: string;
  locale: string;
  systemPrompt: string;
  lastUpdated: string;
}

function CustomerOpsPageContent() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [isApplyUsageOpen, setIsApplyUsageOpen] = useState(false);
  const [isAgentEditorOpen, setIsAgentEditorOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<RetellAgent | null>(null);
  const { toast } = useToast();

  // Fetch customers with lazy loading optimization
  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    staleTime: 30000, // 30 second cache for cost protection
    gcTime: 5 * 60 * 1000 // 5 minute garbage collection
  });

  // Fetch customer billing overview
  const { data: billingOverview, isLoading: billingLoading } = useQuery<CustomerBillingOverview>({
    queryKey: ["/api/customers", selectedCustomerId, "billing", "overview"],
    enabled: !!selectedCustomerId,
    staleTime: 10000
  });

  // Fetch customer bots
  const { data: customerBots = [] } = useQuery({
    queryKey: ["/api/bots"],
    enabled: !!selectedCustomerId,
    select: (data: any[]) => data.filter(bot => bot.tenantId === selectedCustomerId)
  });

  // Fetch Retell agents
  const { data: retellAgents } = useQuery<{ success: boolean; agents: RetellAgent[] }>({
    queryKey: ["/api/retell/agents"],
    enabled: !!selectedCustomerId,
    select: (data) => ({
      ...data,
      agents: data.agents?.filter(agent => agent.tenantId === selectedCustomerId) || []
    })
  });

  // Apply usage mutation
  const applyUsageMutation = useMutation({
    mutationFn: async (data: z.infer<typeof applyUsageSchema>) => {
      const response = await apiRequest('POST', `/api/customers/${selectedCustomerId}/billing/apply-usage`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Usage applied successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCustomerId, "billing"] });
      setIsApplyUsageOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to apply usage", 
        description: error.message || "Unknown error",
        variant: "destructive" 
      });
    }
  });

  // Agent update mutation
  const updateAgentMutation = useMutation({
    mutationFn: async (data: z.infer<typeof agentUpdateSchema>) => {
      if (!selectedAgent) throw new Error("No agent selected");
      const response = await apiRequest('PATCH', `/api/retell/agents/${selectedAgent.botId}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Agent updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/retell/agents"] });
      setIsAgentEditorOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to update agent", 
        description: error.message || "Unknown error",
        variant: "destructive" 
      });
    }
  });

  // Deploy flow mutation
  const deployFlowMutation = useMutation({
    mutationFn: async ({ botId, deployTarget }: { botId: string; deployTarget: string }) => {
      const response = await apiRequest('POST', '/api/retell/deploy-flow', { botId, deployTarget });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Flow deployment initiated" });
    }
  });

  // Open link mutation
  const openLinkMutation = useMutation({
    mutationFn: async ({ botId, linkType }: { botId: string; linkType: string }) => {
      const response = await apiRequest('POST', '/api/retell/open-link', { botId, linkType });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.retellLink) {
        window.open(data.retellLink, '_blank');
        toast({ title: "Opening Retell dashboard" });
      }
    }
  });

  const applyUsageForm = useForm<z.infer<typeof applyUsageSchema>>({
    resolver: zodResolver(applyUsageSchema),
    defaultValues: {
      source: 'manual',
      minuteType: 'voice_bot',
      minutesDecimal: 0,
      periodStart: new Date().toISOString().slice(0, 16),
      periodEnd: new Date().toISOString().slice(0, 16)
    }
  });

  const agentUpdateForm = useForm<z.infer<typeof agentUpdateSchema>>({
    resolver: zodResolver(agentUpdateSchema),
    defaultValues: {
      systemPrompt: selectedAgent?.systemPrompt || "",
      greetingMessage: "",
      locale: selectedAgent?.locale || "en-US"
    }
  });

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  return (
    <AdminGuard>
      <div className="flex h-screen bg-background">
      <AdminSidebar />
      
      <div className="flex-1 ml-72">
        <div className="container mx-auto py-8 px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Customer Operations Dashboard</h1>
            <p className="text-muted-foreground mt-2">
              Manage customer usage, billing, and VoiceAgent configurations
            </p>
          </div>

          {/* Customer Selector */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Select Customer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select 
                value={selectedCustomerId} 
                onValueChange={setSelectedCustomerId}
                disabled={customersLoading}
              >
                <SelectTrigger className="w-full max-w-md" data-testid="select-customer">
                  <SelectValue placeholder="Choose a customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      <div className="flex items-center gap-2">
                        <span>{customer.name}</span>
                        <Badge variant={customer.status === 'active' ? 'default' : 'secondary'}>
                          {customer.status}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedCustomerId && (
            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList data-testid="tabs-customer-ops">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="usage">Usage & Billing</TabsTrigger>
                <TabsTrigger value="agents">Agent Management</TabsTrigger>
                <TabsTrigger value="flows">Flow Controls</TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Customer Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium">Customer Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Name</span>
                        <span className="text-sm font-medium">{selectedCustomer?.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <Badge variant={selectedCustomer?.status === 'active' ? 'default' : 'secondary'}>
                          {selectedCustomer?.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Stripe ID</span>
                        <span className="text-sm font-mono text-xs">
                          {selectedCustomer?.stripeCustomerId?.substring(0, 12) + "..." || "Not configured"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Billing Summary */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Euro className="w-4 h-4" />
                        Current Balance
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {billingOverview?.balance.runningBalanceFormatted || "€0.00"}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Running balance (cents: {billingOverview?.balance.runningBalanceCents || 0})
                      </p>
                    </CardContent>
                  </Card>

                  {/* Usage Summary */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <PhoneCall className="w-4 h-4" />
                        This Month
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {billingOverview?.usage.totalMinutes || 0}
                        <span className="text-sm font-normal text-muted-foreground ml-1">min</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Cost: {billingOverview?.usage.estimatedCostCents ? `€${(billingOverview.usage.estimatedCostCents / 100).toFixed(2)}` : "€0.00"}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Usage & Billing Tab */}
              <TabsContent value="usage" className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Usage & Billing Management</h3>
                  <Dialog open={isApplyUsageOpen} onOpenChange={setIsApplyUsageOpen}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-apply-usage">
                        <Plus className="w-4 h-4 mr-2" />
                        Apply Usage
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Apply Customer Usage</DialogTitle>
                        <DialogDescription>
                          Manually apply usage minutes to customer billing
                        </DialogDescription>
                      </DialogHeader>
                      <Form {...applyUsageForm}>
                        <form 
                          onSubmit={applyUsageForm.handleSubmit((data) => applyUsageMutation.mutate(data))}
                          className="space-y-4"
                        >
                          <FormField
                            control={applyUsageForm.control}
                            name="botId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Bot</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select bot" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {customerBots.map((bot: any) => (
                                      <SelectItem key={bot.id} value={bot.id}>
                                        {bot.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          
                          <FormField
                            control={applyUsageForm.control}
                            name="minuteType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Minute Type</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="voice_bot">Voice Bot Minutes</SelectItem>
                                    <SelectItem value="forwarding">Forwarding Minutes</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          
                          <FormField
                            control={applyUsageForm.control}
                            name="minutesDecimal"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Minutes</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    step="0.1" 
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          
                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={applyUsageForm.control}
                              name="periodStart"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Start Time</FormLabel>
                                  <FormControl>
                                    <Input type="datetime-local" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            
                            <FormField
                              control={applyUsageForm.control}
                              name="periodEnd"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>End Time</FormLabel>
                                  <FormControl>
                                    <Input type="datetime-local" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setIsApplyUsageOpen(false)}>
                              Cancel
                            </Button>
                            <Button type="submit" disabled={applyUsageMutation.isPending}>
                              {applyUsageMutation.isPending ? "Applying..." : "Apply Usage"}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>

                {/* Billing Overview */}
                {billingLoading ? (
                  <Card>
                    <CardContent className="p-6">
                      <div className="animate-pulse space-y-4">
                        <div className="h-4 bg-muted rounded w-1/4"></div>
                        <div className="h-8 bg-muted rounded w-1/2"></div>
                      </div>
                    </CardContent>
                  </Card>
                ) : billingOverview ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm font-medium">Current Period Usage</CardTitle>
                        <CardDescription>
                          {billingOverview.period.start} to {billingOverview.period.end}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm">Voice Bot Minutes</span>
                          <span className="font-medium">{billingOverview.usage.voiceBotMinutes}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Forwarding Minutes</span>
                          <span className="font-medium">{billingOverview.usage.forwardingMinutes}</span>
                        </div>
                        <div className="flex justify-between border-t pt-3">
                          <span className="text-sm font-medium">Total Minutes</span>
                          <span className="font-bold">{billingOverview.usage.totalMinutes}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium">Estimated Cost</span>
                          <span className="font-bold text-primary">
                            €{(billingOverview.usage.estimatedCostCents / 100).toFixed(2)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <CreditCard className="w-4 h-4" />
                          Account Balance
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold mb-2">
                          {billingOverview.balance.runningBalanceFormatted}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Running balance since account creation
                        </p>
                        <div className="mt-4 flex gap-2">
                          <Button variant="outline" size="sm">
                            <ExternalLink className="w-4 h-4 mr-2" />
                            View in Stripe
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">No billing data available</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Agent Management Tab */}
              <TabsContent value="agents" className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Retell Agent Management</h3>
                </div>

                {retellAgents?.agents && retellAgents.agents.length > 0 ? (
                  <div className="grid gap-4">
                    {retellAgents.agents.map((agent) => (
                      <Card key={agent.botId}>
                        <CardHeader>
                          <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className="text-base">{agent.name}</CardTitle>
                              <CardDescription>
                                Agent ID: {agent.retellAgentId} • Locale: {agent.locale}
                              </CardDescription>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedAgent(agent);
                                  agentUpdateForm.reset({
                                    systemPrompt: agent.systemPrompt,
                                    locale: agent.locale
                                  });
                                  setIsAgentEditorOpen(true);
                                }}
                                data-testid={`button-edit-agent-${agent.botId}`}
                              >
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openLinkMutation.mutate({ 
                                  botId: agent.botId, 
                                  linkType: 'dashboard' 
                                })}
                              >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Open
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div>
                              <span className="text-sm font-medium">System Prompt:</span>
                              <p className="text-sm text-muted-foreground mt-1 p-2 bg-muted rounded">
                                {agent.systemPrompt.length > 200 
                                  ? agent.systemPrompt.substring(0, 200) + "..." 
                                  : agent.systemPrompt}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm">Status:</span>
                              <Badge variant={agent.status === 'ready' ? 'default' : 'secondary'}>
                                {agent.status}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <Bot className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">No Retell agents found for this customer</p>
                    </CardContent>
                  </Card>
                )}

                {/* Agent Editor Dialog */}
                <Dialog open={isAgentEditorOpen} onOpenChange={setIsAgentEditorOpen}>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Edit Agent: {selectedAgent?.name}</DialogTitle>
                      <DialogDescription>
                        Update agent configuration (changes will sync to Retell)
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...agentUpdateForm}>
                      <form 
                        onSubmit={agentUpdateForm.handleSubmit((data) => updateAgentMutation.mutate(data))}
                        className="space-y-4"
                      >
                        <FormField
                          control={agentUpdateForm.control}
                          name="systemPrompt"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>System Prompt</FormLabel>
                              <FormControl>
                                <Textarea 
                                  {...field} 
                                  rows={8}
                                  placeholder="Enter the system prompt for this agent..."
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={agentUpdateForm.control}
                          name="greetingMessage"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Greeting Message</FormLabel>
                              <FormControl>
                                <Textarea 
                                  {...field} 
                                  rows={3}
                                  placeholder="Enter the greeting message..."
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={agentUpdateForm.control}
                          name="locale"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Locale</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="en-US">English (US)</SelectItem>
                                  <SelectItem value="en-GB">English (UK)</SelectItem>
                                  <SelectItem value="de-DE">German</SelectItem>
                                  <SelectItem value="fr-FR">French</SelectItem>
                                  <SelectItem value="es-ES">Spanish</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setIsAgentEditorOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" disabled={updateAgentMutation.isPending}>
                            {updateAgentMutation.isPending ? "Updating..." : "Update Agent"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </TabsContent>

              {/* Flow Controls Tab */}
              <TabsContent value="flows" className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Flow Controls & Operations</h3>
                </div>

                {customerBots.length > 0 ? (
                  <div className="grid gap-4">
                    {customerBots.map((bot: any) => (
                      <Card key={bot.id}>
                        <CardHeader>
                          <div className="flex justify-between items-center">
                            <div>
                              <CardTitle className="text-base">{bot.name}</CardTitle>
                              <CardDescription>
                                Bot ID: {bot.id} • Status: {bot.status}
                              </CardDescription>
                            </div>
                            <Badge variant={bot.status === 'ready' ? 'default' : 'secondary'}>
                              {bot.status}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deployFlowMutation.mutate({ 
                                botId: bot.id, 
                                deployTarget: 'staging' 
                              })}
                              disabled={deployFlowMutation.isPending}
                              data-testid={`button-deploy-staging-${bot.id}`}
                            >
                              <Rocket className="w-4 h-4 mr-2" />
                              Deploy to Staging
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deployFlowMutation.mutate({ 
                                botId: bot.id, 
                                deployTarget: 'production' 
                              })}
                              disabled={deployFlowMutation.isPending}
                              data-testid={`button-deploy-production-${bot.id}`}
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Deploy to Production
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openLinkMutation.mutate({ 
                                botId: bot.id, 
                                linkType: 'testing' 
                              })}
                              data-testid={`button-test-link-${bot.id}`}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              Test Agent
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openLinkMutation.mutate({ 
                                botId: bot.id, 
                                linkType: 'analytics' 
                              })}
                              data-testid={`button-analytics-${bot.id}`}
                            >
                              <Activity className="w-4 h-4 mr-2" />
                              View Analytics
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <Settings className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">No bots found for this customer</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
      </div>
    </AdminGuard>
  );
}

export default function CustomerOpsPage() {
  return <CustomerOpsPageContent />;
}