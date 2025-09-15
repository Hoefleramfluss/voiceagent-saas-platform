import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Phone, Building, User, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface DemoTenantData {
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  firstName: string;
  lastName: string;
  industry: string;
  useCase: string;
}

type WizardStep = 'company' | 'contact' | 'details' | 'verification' | 'complete';

export default function DemoSetupPage() {
  const [currentStep, setCurrentStep] = useState<WizardStep>('company');
  const [isLoading, setIsLoading] = useState(false);
  const [tenantId, setTenantId] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [demoData, setDemoData] = useState<DemoTenantData>({
    companyName: '',
    contactEmail: '',
    contactPhone: '',
    firstName: '',
    lastName: '',
    industry: '',
    useCase: ''
  });
  
  const { toast } = useToast();
  
  const steps: Record<WizardStep, { title: string; description: string; icon: any }> = {
    company: {
      title: "Company Information",
      description: "Tell us about your organization",
      icon: Building
    },
    contact: {
      title: "Contact Details", 
      description: "Your contact information",
      icon: User
    },
    details: {
      title: "Demo Details",
      description: "Customize your demo experience",
      icon: Zap
    },
    verification: {
      title: "Phone Verification",
      description: "Verify your phone number",
      icon: Phone
    },
    complete: {
      title: "Setup Complete",
      description: "Your demo is ready!",
      icon: CheckCircle
    }
  };
  
  const stepOrder: WizardStep[] = ['company', 'contact', 'details', 'verification', 'complete'];
  const currentStepIndex = stepOrder.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / stepOrder.length) * 100;
  
  const handleNext = async () => {
    if (currentStep === 'details') {
      await createDemoTenant();
    } else if (currentStep === 'verification') {
      await verifyPhone();
    } else {
      const nextIndex = currentStepIndex + 1;
      if (nextIndex < stepOrder.length) {
        setCurrentStep(stepOrder[nextIndex]);
      }
    }
  };
  
  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(stepOrder[prevIndex]);
    }
  };
  
  const createDemoTenant = async () => {
    setIsLoading(true);
    try {
      const response = await apiRequest('POST', '/api/demo/create-tenant', demoData);
      const result = await response.json();
      
      if (result.success) {
        setTenantId(result.tenantId);
        setCurrentStep('verification');
        toast({
          title: "Demo tenant created!",
          description: "Please verify your phone number to complete setup."
        });
      } else {
        toast({
          title: "Setup failed",
          description: result.error || "Failed to create demo tenant",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Demo setup error:', error);
      toast({
        title: "Setup failed", 
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const verifyPhone = async () => {
    setIsLoading(true);
    try {
      const response = await apiRequest('POST', '/api/demo/verify-phone', {
        tenantId,
        code: verificationCode
      });
      const result = await response.json();
      
      if (result.success) {
        setCurrentStep('complete');
        toast({
          title: "Phone verified!",
          description: "Your demo tenant is now active and ready to use."
        });
      } else {
        toast({
          title: "Verification failed",
          description: result.error || "Invalid verification code",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Verification error:', error);
      toast({
        title: "Verification failed",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const resendCode = async () => {
    setIsLoading(true);
    try {
      const response = await apiRequest('POST', '/api/demo/resend-code', { tenantId });
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Code sent!",
          description: "A new verification code has been sent to your phone."
        });
      } else {
        toast({
          title: "Failed to send code",
          description: result.error || "Failed to resend verification code",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Resend error:', error);
      toast({
        title: "Failed to send code",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const isStepValid = () => {
    switch (currentStep) {
      case 'company':
        return demoData.companyName.trim().length > 0;
      case 'contact':
        return demoData.contactEmail.includes('@') && demoData.contactPhone.length > 0;
      case 'details':
        return demoData.industry.length > 0 && demoData.useCase.length > 0;
      case 'verification':
        return verificationCode.length === 6;
      default:
        return true;
    }
  };
  
  const renderStepContent = () => {
    switch (currentStep) {
      case 'company':
        return (
          <div className="space-y-4" data-testid="step-company">
            <div>
              <Label htmlFor="companyName" data-testid="label-company-name">Company Name *</Label>
              <Input
                id="companyName"
                data-testid="input-company-name"
                value={demoData.companyName}
                onChange={(e) => setDemoData({ ...demoData, companyName: e.target.value })}
                placeholder="Enter your company name"
                required
              />
            </div>
          </div>
        );
        
      case 'contact':
        return (
          <div className="space-y-4" data-testid="step-contact">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName" data-testid="label-first-name">First Name</Label>
                <Input
                  id="firstName"
                  data-testid="input-first-name"
                  value={demoData.firstName}
                  onChange={(e) => setDemoData({ ...demoData, firstName: e.target.value })}
                  placeholder="First name"
                />
              </div>
              <div>
                <Label htmlFor="lastName" data-testid="label-last-name">Last Name</Label>
                <Input
                  id="lastName"
                  data-testid="input-last-name"
                  value={demoData.lastName}
                  onChange={(e) => setDemoData({ ...demoData, lastName: e.target.value })}
                  placeholder="Last name"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="contactEmail" data-testid="label-contact-email">Email Address *</Label>
              <Input
                id="contactEmail"
                data-testid="input-contact-email"
                type="email"
                value={demoData.contactEmail}
                onChange={(e) => setDemoData({ ...demoData, contactEmail: e.target.value })}
                placeholder="your.email@company.com"
                required
              />
            </div>
            <div>
              <Label htmlFor="contactPhone" data-testid="label-contact-phone">Phone Number *</Label>
              <Input
                id="contactPhone"
                data-testid="input-contact-phone"
                value={demoData.contactPhone}
                onChange={(e) => setDemoData({ ...demoData, contactPhone: e.target.value })}
                placeholder="+1 (555) 123-4567"
                required
              />
              <p className="text-sm text-muted-foreground mt-1">
                We'll send a verification code to this number
              </p>
            </div>
          </div>
        );
        
      case 'details':
        return (
          <div className="space-y-4" data-testid="step-details">
            <div>
              <Label htmlFor="industry" data-testid="label-industry">Industry *</Label>
              <Select 
                value={demoData.industry} 
                onValueChange={(value) => setDemoData({ ...demoData, industry: value })}
              >
                <SelectTrigger data-testid="select-industry">
                  <SelectValue placeholder="Select your industry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="technology">Technology</SelectItem>
                  <SelectItem value="healthcare">Healthcare</SelectItem>
                  <SelectItem value="finance">Finance</SelectItem>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="education">Education</SelectItem>
                  <SelectItem value="manufacturing">Manufacturing</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="useCase" data-testid="label-use-case">Primary Use Case *</Label>
              <Textarea
                id="useCase"
                data-testid="textarea-use-case"
                value={demoData.useCase}
                onChange={(e) => setDemoData({ ...demoData, useCase: e.target.value })}
                placeholder="Describe how you plan to use VoiceAgent (e.g., customer support, appointment scheduling, lead qualification)"
                required
              />
            </div>
          </div>
        );
        
      case 'verification':
        return (
          <div className="space-y-4" data-testid="step-verification">
            <div className="text-center">
              <Phone className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                We've sent a 6-digit verification code to:
                <br />
                <strong data-testid="text-phone-number">{demoData.contactPhone}</strong>
              </p>
            </div>
            <div>
              <Label htmlFor="verificationCode" data-testid="label-verification-code">Verification Code</Label>
              <Input
                id="verificationCode"
                data-testid="input-verification-code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                placeholder="123456"
                className="text-center text-2xl tracking-widest font-mono"
                maxLength={6}
              />
            </div>
            <Button 
              variant="outline" 
              onClick={resendCode} 
              disabled={isLoading}
              className="w-full"
              data-testid="button-resend-code"
            >
              Resend Code
            </Button>
          </div>
        );
        
      case 'complete':
        return (
          <div className="text-center space-y-4" data-testid="step-complete">
            <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
            <div>
              <h3 className="text-lg font-semibold" data-testid="text-setup-complete">Setup Complete!</h3>
              <p className="text-muted-foreground" data-testid="text-demo-ready">
                Your VoiceAgent demo is now ready. You can start exploring the platform.
              </p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-sm">
                <strong>Next steps:</strong>
              </p>
              <ul className="text-sm text-left mt-2 space-y-1">
                <li>• Configure your voice bot settings</li>
                <li>• Test voice interactions</li>
                <li>• Explore CRM integrations</li>
                <li>• Review usage analytics</li>
              </ul>
            </div>
            <Button 
              onClick={() => window.location.href = '/customer/dashboard'}
              className="w-full"
              data-testid="button-go-to-dashboard"
            >
              Go to Dashboard
            </Button>
          </div>
        );
        
      default:
        return null;
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" data-testid="text-demo-setup-title">VoiceAgent Demo Setup</h1>
          <p className="text-muted-foreground" data-testid="text-demo-setup-description">
            Get started with your personalized VoiceAgent demo in just a few steps
          </p>
        </div>
        
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2" data-testid="text-current-step">
                  {(() => {
                    const IconComponent = steps[currentStep].icon;
                    return IconComponent ? <IconComponent className="h-5 w-5" /> : null;
                  })()}
                  {steps[currentStep].title}
                </CardTitle>
                <CardDescription data-testid="text-step-description">
                  {steps[currentStep].description}
                </CardDescription>
              </div>
              <div className="text-sm text-muted-foreground" data-testid="text-step-counter">
                Step {currentStepIndex + 1} of {stepOrder.length}
              </div>
            </div>
            <Progress value={progress} className="mt-4" data-testid="progress-setup" />
          </CardHeader>
          
          <CardContent>
            {renderStepContent()}
          </CardContent>
        </Card>
        
        {currentStep !== 'complete' && (
          <div className="flex gap-4">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStepIndex === 0 || isLoading}
              className="flex-1"
              data-testid="button-back"
            >
              Back
            </Button>
            <Button
              onClick={handleNext}
              disabled={!isStepValid() || isLoading}
              className="flex-1"
              data-testid="button-next"
            >
              {isLoading ? 'Processing...' : currentStep === 'verification' ? 'Verify' : 'Next'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}