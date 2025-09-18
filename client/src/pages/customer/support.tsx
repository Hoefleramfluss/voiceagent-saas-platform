import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { SupportTicketsResponse } from "@shared/api-types";
import CustomerSidebar from "@/components/customer-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Headphones, 
  MessageCircle, 
  Plus, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Search,
  Filter,
  Mail,
  Phone
} from "lucide-react";

interface CreateTicketData {
  subject: string;
  body: string;
  priority: string;
}

export default function CustomerSupport() {
  const { user } = useAuth();
  const { toast: showToast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [newTicket, setNewTicket] = useState<CreateTicketData>({
    subject: "",
    body: "",
    priority: "medium"
  });

  const { data: tickets, isLoading } = useQuery<SupportTicketsResponse>({
    queryKey: ["/api/support/tickets"],
    enabled: !!user?.tenantId
  });

  const createTicketMutation = useMutation({
    mutationFn: async (data: CreateTicketData) => {
      const res = await apiRequest("POST", "/api/support/tickets", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      setIsCreateOpen(false);
      setNewTicket({ subject: "", body: "", priority: "medium" });
      showToast({
        title: "Support ticket created",
        description: "Your support request has been submitted successfully.",
      });
    },
    onError: (error) => {
      showToast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    createTicketMutation.mutate(newTicket);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-600" />;
      case 'resolved':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'closed':
        return <CheckCircle className="w-4 h-4 text-gray-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-red-100 text-red-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'resolved':
        return 'bg-green-100 text-green-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredTickets = tickets?.filter((ticket: any) => {
    const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
    const matchesSearch = searchTerm === "" || 
      ticket.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.body.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesStatus && matchesSearch;
  }) || [];

  const ticketStats = {
    total: tickets?.length || 0,
    open: tickets?.filter((t: any) => t.status === 'open').length || 0,
    inProgress: tickets?.filter((t: any) => t.status === 'in_progress').length || 0,
    resolved: tickets?.filter((t: any) => t.status === 'resolved').length || 0,
  };

  if (isLoading) {
    return (
      <div className="flex">
        <CustomerSidebar />
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
      <CustomerSidebar />
      
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Support</h1>
              <p className="text-sm text-muted-foreground">Get help and create support tickets</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-ticket">
                  <Plus className="w-4 h-4 mr-2" />
                  New Support Ticket
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Support Ticket</DialogTitle>
                  <DialogDescription>
                    Describe your issue and we'll help you resolve it as quickly as possible.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateTicket} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ticket-subject">Subject</Label>
                    <Input
                      id="ticket-subject"
                      placeholder="Brief description of your issue"
                      value={newTicket.subject}
                      onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                      required
                      data-testid="input-ticket-subject"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ticket-priority">Priority</Label>
                    <Select
                      value={newTicket.priority}
                      onValueChange={(value) => setNewTicket({ ...newTicket, priority: value })}
                    >
                      <SelectTrigger data-testid="select-ticket-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low - General question</SelectItem>
                        <SelectItem value="medium">Medium - Issue affecting usage</SelectItem>
                        <SelectItem value="high">High - Critical issue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ticket-body">Description</Label>
                    <Textarea
                      id="ticket-body"
                      placeholder="Please provide detailed information about your issue, including steps to reproduce if applicable..."
                      value={newTicket.body}
                      onChange={(e) => setNewTicket({ ...newTicket, body: e.target.value })}
                      rows={6}
                      required
                      data-testid="textarea-ticket-body"
                    />
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
                      disabled={createTicketMutation.isPending}
                      data-testid="button-submit-ticket"
                    >
                      {createTicketMutation.isPending ? "Creating..." : "Create Ticket"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Content */}
        <main className="p-6 space-y-6">
          {/* Quick Help */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-primary" />
                  Contact Information
                </CardTitle>
                <CardDescription>Get in touch with our support team</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Email Support</p>
                  <p className="text-sm text-muted-foreground">support@voiceagent.com</p>
                  <p className="text-xs text-muted-foreground mt-1">Response within 24 hours</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Phone Support</p>
                  <p className="text-sm text-muted-foreground">+49 30 123 456 789</p>
                  <p className="text-xs text-muted-foreground mt-1">Mon-Fri, 9:00-17:00 CET</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-primary" />
                  Common Questions
                </CardTitle>
                <CardDescription>Quick answers to frequent issues</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <details className="group">
                  <summary className="text-sm font-medium text-foreground cursor-pointer group-open:text-primary">
                    How do I test my VoiceBot?
                  </summary>
                  <p className="text-sm text-muted-foreground mt-2">
                    Call your assigned phone number to test the VoiceBot directly. You can find your number in the dashboard.
                  </p>
                </details>
                <details className="group">
                  <summary className="text-sm font-medium text-foreground cursor-pointer group-open:text-primary">
                    How is billing calculated?
                  </summary>
                  <p className="text-sm text-muted-foreground mt-2">
                    Billing is based on usage: call minutes, speech processing requests, and AI interactions.
                  </p>
                </details>
                <details className="group">
                  <summary className="text-sm font-medium text-foreground cursor-pointer group-open:text-primary">
                    Can I change the greeting message?
                  </summary>
                  <p className="text-sm text-muted-foreground mt-2">
                    Contact support to customize your VoiceBot's greeting and conversation flow.
                  </p>
                </details>
              </CardContent>
            </Card>
          </div>

          {/* Ticket Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Tickets</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="stat-total-tickets">
                      {ticketStats.total}
                    </p>
                  </div>
                  <Headphones className="w-8 h-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Open</p>
                    <p className="text-2xl font-bold text-red-600" data-testid="stat-open-tickets">
                      {ticketStats.open}
                    </p>
                  </div>
                  <AlertCircle className="w-8 h-8 text-red-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">In Progress</p>
                    <p className="text-2xl font-bold text-blue-600" data-testid="stat-progress-tickets">
                      {ticketStats.inProgress}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Resolved</p>
                    <p className="text-2xl font-bold text-green-600" data-testid="stat-resolved-tickets">
                      {ticketStats.resolved}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Ticket List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Your Support Tickets</CardTitle>
                  <CardDescription>Track the status of your support requests</CardDescription>
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search tickets..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-[200px]"
                      data-testid="input-search-tickets"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]" data-testid="select-ticket-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredTickets.length === 0 ? (
                <div className="text-center py-12">
                  <Headphones className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    {tickets?.length === 0 ? "No support tickets yet" : "No tickets match your search"}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    {tickets?.length === 0
                      ? "When you create a support ticket, it will appear here."
                      : "Try adjusting your search or filter criteria."
                    }
                  </p>
                  {tickets?.length === 0 && (
                    <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-ticket">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Your First Ticket
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredTickets.map((ticket: any) => (
                    <Card key={ticket.id} className="p-4" data-testid={`ticket-card-${ticket.id}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="font-mono text-sm text-muted-foreground">
                              #{ticket.id.slice(0, 8)}
                            </span>
                            <Badge className={getPriorityColor(ticket.priority)}>
                              {ticket.priority}
                            </Badge>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(ticket.status)}
                              <Badge className={getStatusColor(ticket.status)}>
                                {ticket.status.replace('_', ' ')}
                              </Badge>
                            </div>
                          </div>
                          <h3 className="font-semibold text-foreground mb-2">{ticket.subject}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                            {ticket.body}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>Created {new Date(ticket.createdAt).toLocaleDateString()}</span>
                            <span>Updated {new Date(ticket.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
