import { useAuth } from "@/hooks/use-auth";
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
  Package
} from "lucide-react";

const getNavigation = (t: any) => [
  { name: t('dashboard'), href: "/admin", icon: BarChart },
  { name: t('customers'), href: "/admin/customers", icon: Users },
  { name: t('voiceBots'), href: "/admin/bots", icon: Bot },
  { name: t('billing'), href: "/admin/billing", icon: Receipt },
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
  const { user, logoutMutation } = useAuth();
  const [location, navigate] = useLocation();
  
  const navigation = getNavigation(t);
  const systemNavigation = getSystemNavigation(t);

  const handleLogout = () => {
    logoutMutation.mutate();
  };

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
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
