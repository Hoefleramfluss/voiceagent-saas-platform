import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin-sidebar";
import AdminGuard from "@/components/AdminGuard";
import type { SupportTicketsResponse } from "@shared/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Headphones, 
  MessageCircle, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  User,
  Calendar,
  Plus,
  Filter,
  Search,
  Eye
} from "lucide-react";

function AdminSupportContent() {
  const { toast } = useToast();
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: tickets, isLoading } = useQuery<SupportTicketsResponse>({
    queryKey: ["/api/support/tickets"],
  });

  const updateTicketMutation = useMutation({
    mutationFn: async ({ ticketId, updates }: { ticketId: string; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/support/tickets/${ticketId}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      toast({
        title: "Ticket updated",
        description: "Support ticket has been successfully updated.",
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

  const handleStatusChange = (ticketId: string, newStatus: string) => {
    updateTicketMutation.mutate({
      ticketId,
      updates: { status: newStatus }
    });
  };

  const handleViewTicket = (ticket: any) => {
    setSelectedTicket(ticket);
    setIsViewOpen(true);
  };

  const filteredTickets = tickets?.filter((ticket: any) => {
    const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
    const matchesSearch = searchTerm === "" || 
      ticket.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.body.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesStatus && matchesPriority && matchesSearch;
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
    <AdminGuard requireSupport>
      <div className="flex bg-background min-h-screen">
      <AdminSidebar />
      
      <div className="ml-72 flex-1">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Support</h1>
              <p className="text-sm text-muted-foreground">Manage customer support tickets and inquiries</p>
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
                    <p className="text-sm font-medium text-muted-foreground">Total Tickets</p>
                    <p className="text-3xl font-bold text-foreground" data-testid="metric-total-tickets">
                      {ticketStats.total}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Headphones className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Open Tickets</p>
                    <p className="text-3xl font-bold text-red-600" data-testid="metric-open-tickets">
                      {ticketStats.open}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">In Progress</p>
                    <p className="text-3xl font-bold text-blue-600" data-testid="metric-progress-tickets">
                      {ticketStats.inProgress}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Clock className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Resolved</p>
                    <p className="text-3xl font-bold text-green-600" data-testid="metric-resolved-tickets">
                      {ticketStats.resolved}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search tickets..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                      data-testid="input-search-tickets"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger className="w-[140px]" data-testid="select-priority-filter">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priority</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Support Tickets Table */}
          <Card>
            <CardHeader>
              <CardTitle>Support Tickets</CardTitle>
              <CardDescription>
                {filteredTickets.length} of {ticketStats.total} tickets shown
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredTickets.length === 0 ? (
                <div className="text-center py-12">
                  <Headphones className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    {tickets?.length === 0 ? "No support tickets yet" : "No tickets match your filters"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {tickets?.length === 0 
                      ? "Support tickets will appear here when customers create them."
                      : "Try adjusting your search or filter criteria."
                    }
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticket ID</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTickets.map((ticket: any) => (
                      <TableRow key={ticket.id} data-testid={`row-ticket-${ticket.id}`}>
                        <TableCell>
                          <span className="font-mono text-sm">#{ticket.id.slice(0, 8)}</span>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground line-clamp-1">{ticket.subject}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                              {ticket.body}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                              <User className="w-4 h-4 text-primary-foreground" />
                            </div>
                            <span className="text-sm">Customer #{ticket.authorUserId.slice(0, 8)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(ticket.status)}
                            <Select
                              value={ticket.status}
                              onValueChange={(value) => handleStatusChange(ticket.id, value)}
                            >
                              <SelectTrigger className="w-[120px] h-8">
                                <Badge className={getStatusColor(ticket.status)}>
                                  {ticket.status.replace('_', ' ')}
                                </Badge>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">Open</SelectItem>
                                <SelectItem value="in_progress">In Progress</SelectItem>
                                <SelectItem value="resolved">Resolved</SelectItem>
                                <SelectItem value="closed">Closed</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getPriorityColor(ticket.priority)}>
                            {ticket.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm text-foreground">
                              {new Date(ticket.createdAt).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(ticket.createdAt).toLocaleTimeString()}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewTicket(ticket)}
                            data-testid={`button-view-ticket-${ticket.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* View Ticket Dialog */}
          <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Support Ticket #{selectedTicket?.id?.slice(0, 8)}</DialogTitle>
                <DialogDescription>
                  View and manage support ticket details
                </DialogDescription>
              </DialogHeader>
              {selectedTicket && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium">Status</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {getStatusIcon(selectedTicket.status)}
                        <Badge className={getStatusColor(selectedTicket.status)}>
                          {selectedTicket.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Priority</Label>
                      <div className="mt-1">
                        <Badge className={getPriorityColor(selectedTicket.priority)}>
                          {selectedTicket.priority}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <Label className="text-sm font-medium">Subject</Label>
                    <p className="mt-1 text-sm text-foreground font-medium">{selectedTicket.subject}</p>
                  </div>
                  
                  <div>
                    <Label className="text-sm font-medium">Description</Label>
                    <div className="mt-1 p-3 bg-muted rounded-md">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{selectedTicket.body}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium">Created</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(selectedTicket.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Last Updated</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(selectedTicket.updatedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </main>
      </div>
      </div>
    </AdminGuard>
  );
}

export default function AdminSupport() {
  return <AdminSupportContent />;
}
