import { ReactNode } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { Loader2, ShieldX, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";

interface AdminGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
  requireSupport?: boolean; // Allow support users too
}

export function AdminGuard({ children, fallback, requireSupport = false }: AdminGuardProps) {
  const { hasAdminAccess, isAdmin, isSupport, isLoading, isAuthenticated } = useUserRole();
  const [, navigate] = useLocation();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Überprüfe Berechtigung...</p>
        </div>
      </div>
    );
  }

  // Check if user has required permissions
  const hasRequiredAccess = requireSupport ? hasAdminAccess : isAdmin;

  if (!isAuthenticated || !hasRequiredAccess) {
    // Use custom fallback if provided
    if (fallback) {
      return <>{fallback}</>;
    }

    // Default unauthorized UI
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldX className="w-8 h-8 text-destructive" />
            </div>
            <CardTitle className="text-xl">Zugriff verweigert</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Sie haben keine Berechtigung, auf den Admin-Bereich zuzugreifen.
            </p>
            <div className="bg-muted p-3 rounded-md text-sm">
              <p className="font-medium mb-1">Erforderliche Berechtigung:</p>
              <p className="text-muted-foreground">
                {requireSupport ? "Platform Admin oder Support" : "Platform Admin"}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button 
                onClick={() => navigate("/dashboard")}
                className="w-full"
                data-testid="button-go-to-dashboard"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Zum Kunden-Dashboard
              </Button>
              <Button 
                variant="outline" 
                onClick={() => navigate("/support")}
                className="w-full"
                data-testid="button-contact-support"
              >
                Support kontaktieren
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User has required permissions, render children
  return <>{children}</>;
}

export default AdminGuard;