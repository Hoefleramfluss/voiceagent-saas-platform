import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin-sidebar";
import type { TenantsResponse, BotsResponse } from "@shared/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Bot, Activity, AlertCircle, CheckCircle, Clock, Zap, Edit } from "lucide-react";

interface CreateBotData {
  name: string;
  tenantId: string;
  locale: string;
  sttProvider: string;
  ttsProvider: string;
  greetingMessage: string;
  systemPrompt: string;
}

export default function AdminBots() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<any>(null);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [newBot, setNewBot] = useState<CreateBotData>({
    name: "",
    tenantId: "",
    locale: "en-US",
    sttProvider: "google",
    ttsProvider: "elevenlabs",
    greetingMessage: "Hello! How can I help you today?",
    systemPrompt: "You are a helpful AI assistant. Be polite, professional, and assist users with their inquiries to the best of your ability."
  });

  const { data: tenants } = useQuery<TenantsResponse>({
    queryKey: ["/api/tenants"],
  });

  const { data: bots, isLoading, refetch } = useQuery<BotsResponse>({
    queryKey: ["/api/bots", selectedTenant],
    queryFn: async () => {
      // For admin, we need to fetch bots for all tenants or specific tenant
      if (!selectedTenant) {
        return [];
      }
      const url = `/api/bots?tenantId=${selectedTenant}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        throw new Error('Failed to fetch bots');
      }
      return response.json();
    },
    enabled: !!selectedTenant // Only fetch when tenant is selected
  });

  const createBotMutation = useMutation({
    mutationFn: async (data: CreateBotData) => {
      const res = await apiRequest("POST", "/api/bots", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedTenant] });
      setIsCreateOpen(false);
      setNewBot({
        name: "",
        tenantId: "",
        locale: "en-US",
        sttProvider: "google",
        ttsProvider: "elevenlabs",
        greetingMessage: "Hello! How can I help you today?",
        systemPrompt: "You are a helpful AI assistant. Be polite, professional, and assist users with their inquiries to the best of your ability."
      });
      toast({
        title: "VoiceBot created",
        description: "New VoiceBot provisioning has been started.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateBotMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateBotData> }) => {
      const res = await apiRequest("PATCH", `/api/bots/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedTenant] });
      setIsEditOpen(false);
      setEditingBot(null);
      toast({
        title: "VoiceBot updated",
        description: "VoiceBot configuration has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateBot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBot.tenantId) {
      toast({
        title: "Error",
        description: "Please select a customer.",
        variant: "destructive",
      });
      return;
    }
    createBotMutation.mutate(newBot);
  };

  const handleEditBot = (bot: any) => {
    setEditingBot({
      ...bot,
      systemPrompt: bot.systemPrompt || "You are a helpful AI assistant. Be polite, professional, and assist users with their inquiries to the best of your ability."
    });
    setIsEditOpen(true);
  };

  const handleUpdateBot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBot) return;
    
    const updateData = {
      name: editingBot.name,
      locale: editingBot.locale,
      sttProvider: editingBot.sttProvider,
      ttsProvider: editingBot.ttsProvider,
      greetingMessage: editingBot.greetingMessage,
      systemPrompt: editingBot.systemPrompt
    };
    
    updateBotMutation.mutate({ id: editingBot.id, data: updateData });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'provisioning':
        return <Clock className="w-4 h-4 text-blue-600" />;
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
        return 'bg-green-100 text-green-800';
      case 'provisioning':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  return (
    <div className="flex bg-background min-h-screen">
      <AdminSidebar />
      
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">VoiceBots</h1>
              <p className="text-sm text-muted-foreground">Manage customer VoiceBots and provisioning</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-bot">
                  <Plus className="w-4 h-4 mr-2" />
                  Create VoiceBot
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New VoiceBot</DialogTitle>
                  <DialogDescription>
                    Configure a new VoiceBot for a customer. This will trigger automatic provisioning.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateBot} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bot-name">Bot Name</Label>
                      <Input
                        id="bot-name"
                        placeholder="Customer Support Bot"
                        value={newBot.name}
                        onChange={(e) => setNewBot({ ...newBot, name: e.target.value })}
                        required
                        data-testid="input-bot-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bot-customer">Customer</Label>
                      <Select
                        value={newBot.tenantId}
                        onValueChange={(value) => setNewBot({ ...newBot, tenantId: value })}
                      >
                        <SelectTrigger data-testid="select-customer">
                          <SelectValue placeholder="Select customer" />
                        </SelectTrigger>
                        <SelectContent>
                          {tenants?.map((tenant: any) => (
                            <SelectItem key={tenant.id} value={tenant.id}>
                              {tenant.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bot-locale">Language</Label>
                      <Select
                        value={newBot.locale}
                        onValueChange={(value) => setNewBot({ ...newBot, locale: value })}
                      >
                        <SelectTrigger data-testid="select-locale">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en-US">English (US)</SelectItem>
                          <SelectItem value="en-GB">English (UK)</SelectItem>
                          <SelectItem value="de-DE">German</SelectItem>
                          <SelectItem value="fr-FR">French</SelectItem>
                          <SelectItem value="es-ES">Spanish</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bot-stt">Speech-to-Text</Label>
                      <Select
                        value={newBot.sttProvider}
                        onValueChange={(value) => setNewBot({ ...newBot, sttProvider: value })}
                      >
                        <SelectTrigger data-testid="select-stt">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="google">Google STT</SelectItem>
                          <SelectItem value="azure">Azure STT</SelectItem>
                          <SelectItem value="aws">AWS Transcribe</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bot-tts">Text-to-Speech</Label>
                      <Select
                        value={newBot.ttsProvider}
                        onValueChange={(value) => setNewBot({ ...newBot, ttsProvider: value })}
                      >
                        <SelectTrigger data-testid="select-tts">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                          <SelectItem value="azure">Azure TTS</SelectItem>
                          <SelectItem value="aws">AWS Polly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bot-greeting">Greeting Message</Label>
                    <Textarea
                      id="bot-greeting"
                      placeholder="Hello! How can I help you today?"
                      value={newBot.greetingMessage}
                      onChange={(e) => setNewBot({ ...newBot, greetingMessage: e.target.value })}
                      rows={3}
                      data-testid="textarea-greeting"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bot-system-prompt">System Prompt</Label>
                    <Textarea
                      id="bot-system-prompt"
                      placeholder="You are a helpful AI assistant. Be polite, professional, and assist users with their inquiries..."
                      value={newBot.systemPrompt}
                      onChange={(e) => setNewBot({ ...newBot, systemPrompt: e.target.value })}
                      rows={5}
                      data-testid="textarea-system-prompt"
                      required
                    />
                    <p className="text-sm text-muted-foreground">
                      Define the AI's personality, behavior, and capabilities. Be specific about how it should respond to users.
                    </p>
                  </div>

                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsCreateOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createBotMutation.isPending}
                      data-testid="button-create-bot-submit"
                    >
                      {createBotMutation.isPending ? "Creating..." : "Create VoiceBot"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            {/* Edit Bot Dialog */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Edit VoiceBot</DialogTitle>
                  <DialogDescription>
                    Update the VoiceBot configuration. Changes will be applied immediately.
                  </DialogDescription>
                </DialogHeader>
                {editingBot && (
                  <form onSubmit={handleUpdateBot} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="edit-bot-name">Bot Name</Label>
                        <Input
                          id="edit-bot-name"
                          placeholder="Customer Support Bot"
                          value={editingBot.name}
                          onChange={(e) => setEditingBot({ ...editingBot, name: e.target.value })}
                          required
                          data-testid="input-edit-bot-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-bot-customer">Customer</Label>
                        <Input
                          id="edit-bot-customer"
                          value={tenants?.find(t => t.id === editingBot.tenantId)?.name || 'Unknown'}
                          disabled
                          className="opacity-50"
                        />
                        <p className="text-xs text-muted-foreground">Customer cannot be changed after creation</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="edit-bot-locale">Language</Label>
                        <Select
                          value={editingBot.locale}
                          onValueChange={(value) => setEditingBot({ ...editingBot, locale: value })}
                        >
                          <SelectTrigger data-testid="select-edit-locale">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en-US">English (US)</SelectItem>
                            <SelectItem value="en-GB">English (UK)</SelectItem>
                            <SelectItem value="de-DE">German</SelectItem>
                            <SelectItem value="fr-FR">French</SelectItem>
                            <SelectItem value="es-ES">Spanish</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-bot-stt">Speech-to-Text</Label>
                        <Select
                          value={editingBot.sttProvider}
                          onValueChange={(value) => setEditingBot({ ...editingBot, sttProvider: value })}
                        >
                          <SelectTrigger data-testid="select-edit-stt">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="google">Google STT</SelectItem>
                            <SelectItem value="azure">Azure STT</SelectItem>
                            <SelectItem value="aws">AWS Transcribe</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-bot-tts">Text-to-Speech</Label>
                        <Select
                          value={editingBot.ttsProvider}
                          onValueChange={(value) => setEditingBot({ ...editingBot, ttsProvider: value })}
                        >
                          <SelectTrigger data-testid="select-edit-tts">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                            <SelectItem value="azure">Azure TTS</SelectItem>
                            <SelectItem value="aws">AWS Polly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="edit-bot-greeting">Greeting Message</Label>
                      <Textarea
                        id="edit-bot-greeting"
                        placeholder="Hello! How can I help you today?"
                        value={editingBot.greetingMessage}
                        onChange={(e) => setEditingBot({ ...editingBot, greetingMessage: e.target.value })}
                        rows={3}
                        data-testid="textarea-edit-greeting"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="edit-bot-system-prompt">System Prompt</Label>
                      <Textarea
                        id="edit-bot-system-prompt"
                        placeholder="You are a helpful AI assistant. Be polite, professional, and assist users with their inquiries..."
                        value={editingBot.systemPrompt}
                        onChange={(e) => setEditingBot({ ...editingBot, systemPrompt: e.target.value })}
                        rows={5}
                        data-testid="textarea-edit-system-prompt"
                        required
                      />
                      <p className="text-sm text-muted-foreground">
                        Define the AI's personality, behavior, and capabilities. Be specific about how it should respond to users.
                      </p>
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsEditOpen(false);
                          setEditingBot(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={updateBotMutation.isPending}
                        data-testid="button-update-bot-submit"
                      >
                        {updateBotMutation.isPending ? "Updating..." : "Update VoiceBot"}
                      </Button>
                    </div>
                  </form>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Content */}
        <main className="p-6 space-y-6">
          {/* Customer Filter */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <Label htmlFor="filter-customer">Filter by Customer:</Label>
                <Select
                  value={selectedTenant}
                  onValueChange={(value) => {
                    setSelectedTenant(value);
                    // Trigger bots query when tenant is selected
                    if (value) {
                      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
                    }
                  }}
                >
                  <SelectTrigger className="w-[300px]" data-testid="filter-customer">
                    <SelectValue placeholder="Select customer to view bots" />
                  </SelectTrigger>
                  <SelectContent>
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
                    onClick={() => {
                      setSelectedTenant("");
                      queryClient.setQueryData(["/api/bots"], []);
                    }}
                  >
                    Clear Filter
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Stats Overview */}
          {selectedTenant && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Total Bots</p>
                      <p className="text-3xl font-bold text-foreground">
                        {bots?.length || 0}
                      </p>
                    </div>
                    <Bot className="w-8 h-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Ready</p>
                      <p className="text-3xl font-bold text-green-600">
                        {bots?.filter((b: any) => b.status === 'ready').length || 0}
                      </p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Provisioning</p>
                      <p className="text-3xl font-bold text-blue-600">
                        {bots?.filter((b: any) => b.status === 'provisioning').length || 0}
                      </p>
                    </div>
                    <Activity className="w-8 h-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Failed</p>
                      <p className="text-3xl font-bold text-red-600">
                        {bots?.filter((b: any) => b.status === 'failed').length || 0}
                      </p>
                    </div>
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Bots Table */}
          <Card>
            <CardHeader>
              <CardTitle>VoiceBots</CardTitle>
              <CardDescription>
                {selectedTenant 
                  ? `VoiceBots for selected customer`
                  : "Select a customer to view their VoiceBots"
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedTenant ? (
                <div className="text-center py-12">
                  <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">Select a Customer</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a customer from the filter above to view and manage their VoiceBots.
                  </p>
                </div>
              ) : !bots || bots.length === 0 ? (
                <div className="text-center py-12">
                  <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No VoiceBots yet</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    This customer doesn't have any VoiceBots configured yet.
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-bot">
                    <Plus className="w-4 h-4 mr-2" />
                    Create First VoiceBot
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bot Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Phone Number</TableHead>
                      <TableHead>Language</TableHead>
                      <TableHead>Providers</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bots.map((bot: any) => (
                      <TableRow key={bot.id} data-testid={`row-bot-${bot.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                              <Bot className="w-4 h-4 text-primary-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{bot.name}</p>
                              <p className="text-sm text-muted-foreground">ID: {bot.id.slice(0, 8)}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(bot.status)}
                            <Badge className={getStatusColor(bot.status)}>
                              {bot.status}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          {bot.twilioNumber ? (
                            <span className="font-mono text-sm">{bot.twilioNumber}</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{bot.locale}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Badge variant="secondary" className="text-xs">
                              {bot.sttProvider}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {bot.ttsProvider}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm text-foreground">
                              {new Date(bot.createdAt).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(bot.createdAt).toLocaleTimeString()}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => handleEditBot(bot)}
                              data-testid={`button-edit-${bot.id}`}
                            >
                              <Edit className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                            {bot.status === 'ready' && (
                              <Button size="sm" variant="outline" data-testid={`button-test-${bot.id}`}>
                                <Zap className="w-4 h-4 mr-1" />
                                Test
                              </Button>
                            )}
                            {bot.status === 'failed' && (
                              <Button size="sm" variant="outline" data-testid={`button-retry-${bot.id}`}>
                                Retry
                              </Button>
                            )}
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
