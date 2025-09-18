import { useUserRole } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { 
  ShieldX, 
  ArrowLeft, 
  Mail, 
  User, 
  AlertTriangle 
} from "lucide-react";

export default function UnauthorizedPage() {
  const { user, role, isAuthenticated } = useUserRole();
  const [, navigate] = useLocation();

  const handleGoBack = () => {
    // Redirect based on user role
    if (user?.role === 'customer_admin' || user?.role === 'customer_user') {
      navigate("/dashboard");
    } else {
      navigate("/");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldX className="w-10 h-10 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Zugriff verweigert</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <p className="text-muted-foreground mb-4">
              Sie haben keine Berechtigung, auf diese Seite zuzugreifen.
            </p>
            
            {isAuthenticated && (
              <div className="bg-muted p-4 rounded-lg space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <User className="w-4 h-4" />
                  <span className="font-medium">Ihre aktuelle Rolle:</span>
                  <Badge variant="secondary" data-testid="user-role-badge">
                    {role}
                  </Badge>
                </div>
                
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">Benutzerinformationen:</p>
                  <div className="space-y-1">
                    {user?.firstName && user?.lastName && (
                      <p>Name: {user.firstName} {user.lastName}</p>
                    )}
                    {user?.email && (
                      <p>E-Mail: {user.email}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <h3 className="font-medium text-amber-900 dark:text-amber-100 mb-1">
                  Benötigen Sie Zugriff?
                </h3>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Falls Sie glauben, dass Sie Zugriff auf diese Seite haben sollten, 
                  kontaktieren Sie bitte Ihren Administrator oder unser Support-Team.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Button 
              onClick={handleGoBack}
              className="w-full"
              data-testid="button-go-back"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Zurück zur Startseite
            </Button>
            
            <Button 
              variant="outline" 
              onClick={() => navigate("/support")}
              className="w-full"
              data-testid="button-contact-support"
            >
              <Mail className="w-4 h-4 mr-2" />
              Support kontaktieren
            </Button>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              Wenn Sie denken, dass dies ein Fehler ist, melden Sie sich ab und wieder an.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}