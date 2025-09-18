import { useUserRole } from "@/hooks/useUserRole";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { 
  Bot, 
  BarChart, 
  Users, 
  Receipt, 
  Settings, 
  Headphones, 
  Server, 
  FileText,
  LogOut,
  Package,
  Monitor,
  ArrowLeft
} from "lucide-react";

const getNavigation = (t: any) => [
  { name: t('dashboard'), href: "/admin", icon: BarChart },
  { name: t('customers'), href: "/admin/customers", icon: Users },
  { name: t('voiceBots'), href: "/admin/bots", icon: Bot },
  { name: t('billing'), href: "/admin/billing", icon: Receipt },
  { name: "Customer Ops", href: "/admin/customer-ops", icon: Monitor },
  { name: "Paket-Verwaltung", href: "/admin/packages", icon: Package },
  { name: t('support'), href: "/admin/support", icon: Headphones },
  { name: t('settings'), href: "/admin/settings", icon: Settings },
];

const getSystemNavigation = (t: any) => [
  { name: t('systemHealth'), href: "/admin/health", icon: Server },
  { name: "Protokolle", href: "/admin/logs", icon: FileText },
];

export default function AdminSidebar() {
  const { t } = useTranslation();
  const { user, hasAdminAccess, isLoading } = useUserRole();
  const [location, navigate] = useLocation();

  // Don't render sidebar if user doesn't have admin access
  if (isLoading) {
    return (
      <div className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border">
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
            <p className="text-sm text-muted-foreground">Lade...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAdminAccess) {
    return (
      <div className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border">
        <div className="flex items-center justify-center h-full">
          <div className="text-center p-6">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-destructive" />
            </div>
            <h3 className="font-semibold mb-2">Zugriff verweigert</h3>
            <p className="text-sm text-muted-foreground mb-4">Admin-Berechtigung erforderlich</p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => navigate("/dashboard")}
              data-testid="button-to-customer-area"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Zum Kunden-Bereich
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    // Redirect to Replit Auth logout
    window.location.assign("/api/logout");
  };
  
  const navigation = getNavigation(t);
  const systemNavigation = getSystemNavigation(t);

  return (
    <div className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border">
      {/* Logo & Brand */}
      <div className="flex items-center gap-3 p-6 border-b border-border">
        <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
          <Bot className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">VoiceAgent</h1>
          <p className="text-xs text-muted-foreground">Admin-Portal</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-4 space-y-2">
        <div className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <Button
                key={item.name}
                variant={isActive ? "secondary" : "ghost"}
                className="w-full justify-start gap-3"
                onClick={() => navigate(item.href)}
                data-testid={`nav-${item.name.toLowerCase()}`}
              >
                <Icon className="w-4 h-4" />
                {item.name}
              </Button>
            );
          })}
        </div>
        
        <div className="pt-4 border-t border-border">
          <p className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            System
          </p>
          {systemNavigation.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <Button
                key={item.name}
                variant={isActive ? "secondary" : "ghost"}
                className="w-full justify-start gap-3"
                onClick={() => navigate(item.href)}
                data-testid={`nav-${item.name.toLowerCase().replace(' ', '-')}`}
              >
                <Icon className="w-4 h-4" />
                {item.name}
              </Button>
            );
          })}
        </div>
      </nav>

      {/* User Profile */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <span className="text-sm font-medium text-primary-foreground">
              {user?.firstName?.[0] || user?.email?.[0] || 'A'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {user?.firstName && user?.lastName 
                ? `${user.firstName} ${user.lastName}` 
                : user?.email || 'Admin User'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.email || 'admin@voiceagent.com'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
