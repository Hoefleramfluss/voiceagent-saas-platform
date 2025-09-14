import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import AdminSidebar from "@/components/admin-sidebar";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Package,
  Euro, 
  Clock,
  Phone,
  PhoneForwarded,
  Plus,
  Edit,
  Save,
  X,
  CheckCircle,
  AlertCircle,
  Settings
} from "lucide-react";

// Enhanced subscription plan interface with minute tracking
interface EnhancedSubscriptionPlan {
  id: string;
  name: string;
  description: string;
  monthlyPriceEur: string;
  yearlyPriceEur?: string;
  features: string[];
  limits: Record<string, any>;
  // New minute tracking fields
  freeVoiceBotMinutes: number;
  freeForwardingMinutes: number;
  voiceBotRatePerMinuteCents: number;
  forwardingRatePerMinuteCents: number;
  status: 'active' | 'inactive' | 'deprecated';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// Form schema for package configuration
const packageFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z.string().optional(),
  monthlyPriceEur: z.string().min(1, "Monthly price is required"),
  yearlyPriceEur: z.string().optional(),
  freeVoiceBotMinutes: z.coerce.number().min(0, "Must be 0 or greater"),
  freeForwardingMinutes: z.coerce.number().min(0, "Must be 0 or greater"),
  voiceBotRatePerMinuteCents: z.coerce.number().min(1, "Rate must be at least 1 cent"),
  forwardingRatePerMinuteCents: z.coerce.number().min(1, "Rate must be at least 1 cent"),
  status: z.enum(['active', 'inactive', 'deprecated']),
  features: z.string() // Comma-separated features
});

type PackageFormData = z.infer<typeof packageFormSchema>;

export default function PackageManagement() {
  const { toast } = useToast();
  const [editingPlan, setEditingPlan] = useState<EnhancedSubscriptionPlan | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  // Get subscription plans
  const { data: plans = [], isLoading: loadingPlans, refetch: refetchPlans } = useQuery<EnhancedSubscriptionPlan[]>({
    queryKey: ["/api/subscription/plans"],
    queryFn: async () => {
      const response = await fetch("/api/admin/packages", {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch plans');
      return response.json();
    }
  });

  const form = useForm<PackageFormData>({
    resolver: zodResolver(packageFormSchema),
    defaultValues: {
      name: "",
      description: "",
      monthlyPriceEur: "0",
      yearlyPriceEur: "0",
      freeVoiceBotMinutes: 0,
      freeForwardingMinutes: 0,
      voiceBotRatePerMinuteCents: 5,
      forwardingRatePerMinuteCents: 3,
      status: 'active',
      features: ""
    }
  });

  // Create or update package mutation
  const savePackageMutation = useMutation({
    mutationFn: async (data: PackageFormData) => {
      const payload = {
        ...data,
        features: data.features.split(',').map(f => f.trim()).filter(Boolean),
        limits: {
          bots: 10, // Default bot limit
          calls_per_month: 10000,
          minutes_per_month: data.freeVoiceBotMinutes + data.freeForwardingMinutes,
        }
      };

      const endpoint = editingPlan ? `/api/admin/packages/${editingPlan.id}` : "/api/admin/packages";
      const method = editingPlan ? "PUT" : "POST";
      
      const response = await apiRequest(method, endpoint, payload);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: editingPlan ? "Plan Updated" : "Plan Created",
        description: `Package ${editingPlan ? 'updated' : 'created'} successfully`
      });
      setShowDialog(false);
      setEditingPlan(null);
      form.reset();
      refetchPlans();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save package",
        variant: "destructive"
      });
    }
  });

  // Delete package mutation
  const deletePackageMutation = useMutation({
    mutationFn: async (packageId: string) => {
      const response = await apiRequest("DELETE", `/api/admin/packages/${packageId}`, {});
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Plan Deleted",
        description: "Package deleted successfully"
      });
      refetchPlans();
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete package",
        variant: "destructive"
      });
    }
  });

  const handleEditPlan = (plan: EnhancedSubscriptionPlan) => {
    setEditingPlan(plan);
    form.reset({
      name: plan.name,
      description: plan.description || "",
      monthlyPriceEur: plan.monthlyPriceEur,
      yearlyPriceEur: plan.yearlyPriceEur || "",
      freeVoiceBotMinutes: plan.freeVoiceBotMinutes,
      freeForwardingMinutes: plan.freeForwardingMinutes,
      voiceBotRatePerMinuteCents: plan.voiceBotRatePerMinuteCents,
      forwardingRatePerMinuteCents: plan.forwardingRatePerMinuteCents,
      status: plan.status,
      features: plan.features.join(', ')
    });
    setShowDialog(true);
  };

  const handleCreateNew = () => {
    setEditingPlan(null);
    form.reset();
    setShowDialog(true);
  };

  const formatCentsToEur = (cents: number): string => {
    return `€${(cents / 100).toFixed(3)}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Aktiv</Badge>;
      case 'inactive':
        return <Badge className="bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" />Inaktiv</Badge>;
      case 'deprecated':
        return <Badge className="bg-red-100 text-red-800"><AlertCircle className="w-3 h-3 mr-1" />Veraltet</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Unbekannt</Badge>;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Paket-Verwaltung</h1>
              <p className="text-muted-foreground mt-2">Konfigurieren Sie Abonnementpläne mit flexiblen Minuten-Paketen</p>
            </div>
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogTrigger asChild>
                <Button onClick={handleCreateNew} data-testid="button-create-package">
                  <Plus className="w-4 h-4 mr-2" />
                  Neues Paket
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {editingPlan ? 'Paket bearbeiten' : 'Neues Paket erstellen'}
                  </DialogTitle>
                  <DialogDescription>
                    Konfigurieren Sie Grundgebühr, kostenlose Minuten und Zusatzgebühren
                  </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit((data) => savePackageMutation.mutate(data))} className="space-y-6">
                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Paket-Name</FormLabel>
                            <FormControl>
                              <Input placeholder="z.B. Professional" {...field} data-testid="input-package-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-package-status">
                                  <SelectValue placeholder="Status wählen" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="active">Aktiv</SelectItem>
                                <SelectItem value="inactive">Inaktiv</SelectItem>
                                <SelectItem value="deprecated">Veraltet</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Beschreibung</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Paket-Beschreibung..." {...field} data-testid="textarea-package-description" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="monthlyPriceEur"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Monatliche Grundgebühr (EUR)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" placeholder="29.00" {...field} data-testid="input-monthly-price" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="yearlyPriceEur"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Jährliche Grundgebühr (EUR)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" placeholder="290.00" {...field} data-testid="input-yearly-price" />
                            </FormControl>
                            <FormDescription>Optional - für Jahresrabatt</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="border-t pt-4">
                      <h3 className="text-lg font-medium mb-4 flex items-center">
                        <Clock className="w-5 h-5 mr-2" />
                        Kostenlose Minuten pro Monat
                      </h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="freeVoiceBotMinutes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center">
                                <Phone className="w-4 h-4 mr-1" />
                                VoiceBot Minuten
                              </FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="100" {...field} data-testid="input-free-voicebot-minutes" />
                              </FormControl>
                              <FormDescription>Kostenlose VoiceBot-Gesprächsminuten</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="freeForwardingMinutes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center">
                                <PhoneForwarded className="w-4 h-4 mr-1" />
                                Weiterleitungs-Minuten
                              </FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="50" {...field} data-testid="input-free-forwarding-minutes" />
                              </FormControl>
                              <FormDescription>Kostenlose Anrufweiterleitungsminuten</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <h3 className="text-lg font-medium mb-4 flex items-center">
                        <Euro className="w-5 h-5 mr-2" />
                        Zusatzgebühren (Cent pro Minute)
                      </h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="voiceBotRatePerMinuteCents"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>VoiceBot Zusatz-Rate (Cent)</FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="5" {...field} data-testid="input-voicebot-rate" />
                              </FormControl>
                              <FormDescription>Preis pro zusätzlicher VoiceBot-Minute</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="forwardingRatePerMinuteCents"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Weiterleitung Zusatz-Rate (Cent)</FormLabel>
                              <FormControl>
                                <Input type="number" placeholder="3" {...field} data-testid="input-forwarding-rate" />
                              </FormControl>
                              <FormDescription>Preis pro zusätzlicher Weiterleitungsminute</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="features"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Features (kommagetrennt)</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Unbegrenzte Bots, 24/7 Support, Premium Stimmen" 
                              {...field} 
                              data-testid="textarea-package-features"
                            />
                          </FormControl>
                          <FormDescription>Liste der enthaltenen Features</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-4 pt-4">
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={() => setShowDialog(false)}
                        data-testid="button-cancel"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Abbrechen
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={savePackageMutation.isPending}
                        data-testid="button-save-package"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {savePackageMutation.isPending ? 'Speichere...' : (editingPlan ? 'Aktualisieren' : 'Erstellen')}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Verfügbare Pakete
              </CardTitle>
              <CardDescription>
                Verwalten Sie Ihre Abonnementpläne mit konfigurierbaren Minuten-Kontingenten
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPlans ? (
                <div className="text-center py-8 text-muted-foreground">Lade Pakete...</div>
              ) : plans.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Preis/Monat</TableHead>
                      <TableHead className="text-center">Kostenlose Minuten</TableHead>
                      <TableHead className="text-center">Zusatz-Raten</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((plan) => (
                      <TableRow key={plan.id} data-testid={`row-package-${plan.id}`}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{plan.name}</div>
                            <div className="text-sm text-muted-foreground">{plan.description}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold">€{parseFloat(plan.monthlyPriceEur).toFixed(2)}</div>
                          {plan.yearlyPriceEur && (
                            <div className="text-sm text-muted-foreground">
                              €{parseFloat(plan.yearlyPriceEur).toFixed(2)}/Jahr
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="space-y-1">
                            <div className="flex items-center justify-center text-sm">
                              <Phone className="w-3 h-3 mr-1" />
                              {plan.freeVoiceBotMinutes} VB-Min
                            </div>
                            <div className="flex items-center justify-center text-sm">
                              <PhoneForwarded className="w-3 h-3 mr-1" />
                              {plan.freeForwardingMinutes} WL-Min
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="space-y-1">
                            <div className="text-sm">VB: {formatCentsToEur(plan.voiceBotRatePerMinuteCents)}/min</div>
                            <div className="text-sm">WL: {formatCentsToEur(plan.forwardingRatePerMinuteCents)}/min</div>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(plan.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleEditPlan(plan)}
                              data-testid={`button-edit-${plan.id}`}
                            >
                              <Edit className="w-3 h-3 mr-1" />
                              Bearbeiten
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => deletePackageMutation.mutate(plan.id)}
                              disabled={deletePackageMutation.isPending}
                              data-testid={`button-delete-${plan.id}`}
                            >
                              <X className="w-3 h-3 mr-1" />
                              Löschen
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Keine Pakete verfügbar. Erstellen Sie Ihr erstes Paket.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}