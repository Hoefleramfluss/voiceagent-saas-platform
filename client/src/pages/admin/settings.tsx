import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin-sidebar";
import type { ApiKey } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Key, Edit, Trash2, Eye, EyeOff, Settings } from "lucide-react";

interface CreateApiKeyData {
  keyName: string;
  keyValue: string;
  serviceType: 'stripe' | 'openai' | 'twilio' | 'google' | 'elevenlabs' | 'heroku';
  description: string;
  isActive: boolean;
}

interface EditApiKeyData {
  keyName: string;
  keyValue?: string;
  serviceType: 'stripe' | 'openai' | 'twilio' | 'google' | 'elevenlabs' | 'heroku';
  description: string;
  isActive: boolean;
}

const serviceTypeLabels = {
  stripe: 'Stripe',
  openai: 'OpenAI',
  twilio: 'Twilio',
  google: 'Google Cloud',
  elevenlabs: 'ElevenLabs',
  heroku: 'Heroku'
} as const;

const serviceTypeColors = {
  stripe: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  openai: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  twilio: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  google: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  elevenlabs: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  heroku: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
} as const;

export default function AdminSettings() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [deletingKey, setDeletingKey] = useState<ApiKey | null>(null);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  
  const [newApiKey, setNewApiKey] = useState<CreateApiKeyData>({
    keyName: "",
    keyValue: "",
    serviceType: "stripe",
    description: "",
    isActive: true
  });

  const [editApiKey, setEditApiKey] = useState<EditApiKeyData>({
    keyName: "",
    keyValue: "",
    serviceType: "stripe",
    description: "",
    isActive: true
  });

  const { data: apiKeys, isLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/admin/api-keys"],
  });

  const createApiKeyMutation = useMutation({
    mutationFn: async (data: CreateApiKeyData) => {
      const res = await apiRequest("POST", "/api/admin/api-keys", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setIsCreateOpen(false);
      setNewApiKey({
        keyName: "",
        keyValue: "",
        serviceType: "stripe",
        description: "",
        isActive: true
      });
      toast({
        title: "API key created",
        description: "New API key has been successfully added.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateApiKeyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EditApiKeyData }) => {
      const res = await apiRequest("PATCH", `/api/admin/api-keys/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setEditingKey(null);
      toast({
        title: "API key updated",
        description: "API key has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setDeletingKey(null);
      toast({
        title: "API key deleted",
        description: "API key has been successfully removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    createApiKeyMutation.mutate(newApiKey);
  };

  const handleUpdateApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingKey) {
      updateApiKeyMutation.mutate({
        id: editingKey.id,
        data: editApiKey
      });
    }
  };

  const handleEditClick = (apiKey: ApiKey) => {
    setEditingKey(apiKey);
    setEditApiKey({
      keyName: apiKey.keyName,
      serviceType: apiKey.serviceType,
      description: apiKey.description || "",
      isActive: apiKey.isActive
    });
  };

  const toggleShowValue = (keyId: string) => {
    setShowValues(prev => ({
      ...prev,
      [keyId]: !prev[keyId]
    }));
  };

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
    <div className="flex bg-background min-h-screen">
      <AdminSidebar />
      
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">Manage API keys and system configuration</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-api-key">
                  <Plus className="w-4 h-4 mr-2" />
                  Add API Key
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New API Key</DialogTitle>
                  <DialogDescription>
                    Add a new API key for external service integration.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateApiKey} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="key-name">Key Name</Label>
                      <Input
                        id="key-name"
                        placeholder="STRIPE_SECRET_KEY"
                        value={newApiKey.keyName}
                        onChange={(e) => setNewApiKey({ ...newApiKey, keyName: e.target.value })}
                        required
                        data-testid="input-key-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="service-type">Service Type</Label>
                      <Select value={newApiKey.serviceType} onValueChange={(value: any) => setNewApiKey({ ...newApiKey, serviceType: value })}>
                        <SelectTrigger data-testid="select-service-type">
                          <SelectValue placeholder="Select service" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stripe">Stripe</SelectItem>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="twilio">Twilio</SelectItem>
                          <SelectItem value="google">Google Cloud</SelectItem>
                          <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                          <SelectItem value="heroku">Heroku</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="key-value">Key Value</Label>
                    <Input
                      id="key-value"
                      type="password"
                      placeholder="sk_test_..."
                      value={newApiKey.keyValue}
                      onChange={(e) => setNewApiKey({ ...newApiKey, keyValue: e.target.value })}
                      required
                      data-testid="input-key-value"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description (Optional)</Label>
                    <Textarea
                      id="description"
                      placeholder="Description of this API key..."
                      value={newApiKey.description}
                      onChange={(e) => setNewApiKey({ ...newApiKey, description: e.target.value })}
                      data-testid="input-description"
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsCreateOpen(false)}
                      data-testid="button-cancel-create"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createApiKeyMutation.isPending}
                      data-testid="button-save-api-key"
                    >
                      {createApiKeyMutation.isPending ? "Creating..." : "Create Key"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Main content */}
        <main className="p-6">
          <div className="space-y-6">
            {/* API Keys Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  API Keys
                </CardTitle>
                <CardDescription>
                  Manage API keys for external service integrations
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!apiKeys || apiKeys.length === 0 ? (
                  <div className="text-center py-8">
                    <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No API Keys</h3>
                    <p className="text-muted-foreground mb-4">
                      Get started by adding your first API key.
                    </p>
                    <Button onClick={() => setIsCreateOpen(true)} data-testid="button-add-first-api-key">
                      <Plus className="w-4 h-4 mr-2" />
                      Add API Key
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apiKeys.map((apiKey) => (
                        <TableRow key={apiKey.id} data-testid={`row-api-key-${apiKey.id}`}>
                          <TableCell>
                            <div>
                              <div className="font-medium" data-testid={`text-key-name-${apiKey.id}`}>
                                {apiKey.keyName}
                              </div>
                              {apiKey.description && (
                                <div className="text-sm text-muted-foreground">
                                  {apiKey.description}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={serviceTypeColors[apiKey.serviceType]} data-testid={`badge-service-${apiKey.id}`}>
                              {serviceTypeLabels[apiKey.serviceType]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-mono" data-testid={`text-key-value-${apiKey.id}`}>
                                {showValues[apiKey.id] ? apiKey.keyValue : apiKey.keyValue}
                              </code>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleShowValue(apiKey.id)}
                                data-testid={`button-toggle-value-${apiKey.id}`}
                              >
                                {showValues[apiKey.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant={apiKey.isActive ? "default" : "secondary"}
                              data-testid={`badge-status-${apiKey.id}`}
                            >
                              {apiKey.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-created-${apiKey.id}`}>
                            {new Date(apiKey.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditClick(apiKey)}
                                data-testid={`button-edit-${apiKey.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeletingKey(apiKey)}
                                data-testid={`button-delete-${apiKey.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
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
          </div>
        </main>

        {/* Edit API Key Dialog */}
        <Dialog open={!!editingKey} onOpenChange={(open) => !open && setEditingKey(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit API Key</DialogTitle>
              <DialogDescription>
                Update API key information. Leave key value empty to keep current value.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpdateApiKey} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-key-name">Key Name</Label>
                  <Input
                    id="edit-key-name"
                    value={editApiKey.keyName}
                    onChange={(e) => setEditApiKey({ ...editApiKey, keyName: e.target.value })}
                    required
                    data-testid="input-edit-key-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-service-type">Service Type</Label>
                  <Select value={editApiKey.serviceType} onValueChange={(value: any) => setEditApiKey({ ...editApiKey, serviceType: value })}>
                    <SelectTrigger data-testid="select-edit-service-type">
                      <SelectValue placeholder="Select service" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="twilio">Twilio</SelectItem>
                      <SelectItem value="google">Google Cloud</SelectItem>
                      <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                      <SelectItem value="heroku">Heroku</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-key-value">New Key Value (Optional)</Label>
                <Input
                  id="edit-key-value"
                  type="password"
                  placeholder="Leave empty to keep current value"
                  value={editApiKey.keyValue || ""}
                  onChange={(e) => setEditApiKey({ ...editApiKey, keyValue: e.target.value })}
                  data-testid="input-edit-key-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={editApiKey.description}
                  onChange={(e) => setEditApiKey({ ...editApiKey, description: e.target.value })}
                  data-testid="input-edit-description"
                />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-is-active"
                  checked={editApiKey.isActive}
                  onChange={(e) => setEditApiKey({ ...editApiKey, isActive: e.target.checked })}
                  data-testid="checkbox-edit-is-active"
                />
                <Label htmlFor="edit-is-active">Active</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingKey(null)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateApiKeyMutation.isPending}
                  data-testid="button-save-edit"
                >
                  {updateApiKeyMutation.isPending ? "Updating..." : "Update Key"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deletingKey} onOpenChange={(open) => !open && setDeletingKey(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete API Key</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the API key "{deletingKey?.keyName}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deletingKey && deleteApiKeyMutation.mutate(deletingKey.id)}
                disabled={deleteApiKeyMutation.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteApiKeyMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}