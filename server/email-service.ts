// SendGrid import moved to initialize() method for optional dependency handling

// HTML escaping utility to prevent HTML/XSS injection in email templates
function escapeHtml(unsafe: string): string {
  if (typeof unsafe !== 'string') {
    return String(unsafe || '');
  }
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Secure logging utility that masks sensitive data
function logSafely(logType: 'info' | 'error', template: EmailTemplate, context: string, error?: string): void {
  const maskedTemplate = {
    to: template.to,
    subject: template.subject,
    // Only show first few characters of content to confirm it exists without exposing secrets
    contentPreview: template.text.substring(0, 50) + '...[MASKED]'
  };
  
  if (logType === 'error' && error) {
    console.error(`[EMAIL] ${context}:`, error, '| Template:', maskedTemplate);
  } else {
    console.log(`[EMAIL] ${context} | Template:`, maskedTemplate);
  }
}

export interface EmailTemplate {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface WelcomeEmailData {
  email: string;
  firstName?: string;
  lastName?: string;
  tempPassword: string;
  tenantName: string;
  loginUrl: string;
}

export interface SupportTicketEmailData {
  to: string;
  ticketId: string;
  subject: string;
  message: string;
  priority: string;
}

export class EmailService {
  private static instance: EmailService;
  private isConfigured = false;
  private sgMail: any = null; // Dynamic import reference

  private constructor() {
    this.initialize();
  }

  static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private async initialize(): Promise<void> {
    const apiKey = process.env.SENDGRID_API_KEY;
    
    if (!apiKey) {
      console.warn('[EMAIL] SENDGRID_API_KEY not found. Email functionality will use secure console logging only.');
      this.isConfigured = false;
      return;
    }

    try {
      // Dynamic import to make SendGrid optional dependency
      const sgMailModule = await import('@sendgrid/mail');
      this.sgMail = sgMailModule.default;
      
      this.sgMail.setApiKey(apiKey);
      this.isConfigured = true;
      console.log('[EMAIL] SendGrid configured successfully');
    } catch (error) {
      console.error('[EMAIL] Failed to configure SendGrid (package may not be available):', (error as Error).message);
      this.isConfigured = false;
      this.sgMail = null;
    }
  }

  private generateWelcomeEmailTemplate(data: WelcomeEmailData): EmailTemplate {
    const { email, firstName, lastName, tempPassword, tenantName, loginUrl } = data;
    
    // Escape all user-controlled input to prevent HTML injection
    const safeEmail = escapeHtml(email);
    const safeFirstName = firstName ? escapeHtml(firstName) : '';
    const safeLastName = lastName ? escapeHtml(lastName) : '';
    const safeTenantName = escapeHtml(tenantName);
    const safeLoginUrl = escapeHtml(loginUrl);
    const safeTempPassword = escapeHtml(tempPassword);
    
    const displayName = safeFirstName && safeLastName ? `${safeFirstName} ${safeLastName}` : safeFirstName || safeEmail;

    const subject = `Welcome to ${safeTenantName} - Your VoiceAgent Account`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to ${safeTenantName}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .content { padding: 20px 0; }
          .credentials { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107; }
          .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 14px; color: #6c757d; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to VoiceAgent</h1>
            <p>Your account has been created for <strong>${safeTenantName}</strong></p>
          </div>
          
          <div class="content">
            <p>Hi ${displayName},</p>
            
            <p>Welcome to VoiceAgent! Your account has been successfully created and you can now access your voice bot management platform.</p>
            
            <div class="credentials">
              <h3>🔐 Your Login Credentials</h3>
              <p><strong>Email:</strong> ${safeEmail}</p>
              <p><strong>Temporary Password:</strong> <code>${safeTempPassword}</code></p>
              <p><strong>Login URL:</strong> <a href="${safeLoginUrl}">${safeLoginUrl}</a></p>
            </div>
            
            <p><strong>⚠️ Important:</strong> For security reasons, please log in and change your password immediately after your first login.</p>
            
            <a href="${safeLoginUrl}" class="button">Login to Your Account</a>
            
            <p>If you have any questions or need assistance, please don't hesitate to reach out to our support team.</p>
            
            <p>Best regards,<br>The VoiceAgent Team</p>
          </div>
          
          <div class="footer">
            <p>This email was sent to ${safeEmail} as part of your VoiceAgent account creation process.</p>
            <p>If you believe you received this email in error, please contact your system administrator.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
Welcome to ${safeTenantName} - Your VoiceAgent Account

Hi ${displayName},

Your VoiceAgent account has been created for ${safeTenantName}.

Login Details:
Email: ${safeEmail}
Temporary Password: ${safeTempPassword}
Login URL: ${safeLoginUrl}

Please login and change your password immediately for security.

Best regards,
VoiceAgent Team

---
This email was sent to ${safeEmail} as part of your VoiceAgent account creation.
If you received this in error, please contact your system administrator.
    `;

    return {
      to: safeEmail,
      subject,
      html,
      text
    };
  }

  private generateSupportNotificationTemplate(data: SupportTicketEmailData): EmailTemplate {
    const { to, ticketId, subject, message, priority } = data;
    
    // Escape all user-controlled input to prevent HTML injection
    const safeTo = escapeHtml(to);
    const safeTicketId = escapeHtml(ticketId);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);
    
    // Validate priority to prevent CSS injection - only allow known values
    const allowedPriorities = ['low', 'medium', 'high'];
    const safePriority = allowedPriorities.includes(priority.toLowerCase()) 
      ? priority.toLowerCase() 
      : 'medium'; // Default to medium for invalid priorities
    
    const emailSubject = `Support Ticket #${safeTicketId}: ${safeSubject}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Support Ticket ${safeTicketId}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .priority-high { color: #dc3545; font-weight: bold; }
          .priority-medium { color: #fd7e14; font-weight: bold; }
          .priority-low { color: #28a745; font-weight: bold; }
          .ticket-info { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .message { background: white; padding: 20px; border: 1px solid #dee2e6; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎫 Support Ticket Created</h1>
            <p>Ticket #${safeTicketId} has been submitted</p>
          </div>
          
          <div class="ticket-info">
            <p><strong>Ticket ID:</strong> ${safeTicketId}</p>
            <p><strong>Priority:</strong> <span class="priority-${safePriority}">${safePriority.toUpperCase()}</span></p>
            <p><strong>Subject:</strong> ${safeSubject}</p>
            <p><strong>Submitted by:</strong> ${safeTo}</p>
          </div>
          
          <div class="message">
            <h3>Message:</h3>
            <p>${safeMessage.replace(/\n/g, '<br>')}</p>
          </div>
          
          <p>Our support team will review your ticket and respond as soon as possible based on the priority level.</p>
          
          <p>You will receive updates via email when there are changes to your ticket status.</p>
          
          <p>Best regards,<br>VoiceAgent Support Team</p>
        </div>
      </body>
      </html>
    `;

    const text = `
Support Ticket #${safeTicketId} Created

Ticket ID: ${safeTicketId}
Priority: ${safePriority.toUpperCase()}
Subject: ${safeSubject}
Submitted by: ${safeTo}

Message:
${safeMessage}

Our support team will review your ticket and respond as soon as possible.

Best regards,
VoiceAgent Support Team
    `;

    return {
      to: safeTo,
      subject: emailSubject,
      html,
      text
    };
  }

  async sendWelcomeEmail(data: WelcomeEmailData): Promise<{ success: boolean; error?: string }> {
    try {
      // Re-initialize if not configured (handles async initialization)
      if (!this.isConfigured && !this.sgMail) {
        await this.initialize();
      }
      
      const template = this.generateWelcomeEmailTemplate(data);
      
      if (!this.isConfigured || !this.sgMail) {
        // Secure fallback logging - never expose sensitive data
        logSafely('info', template, 'Welcome email queued (SendGrid not configured)');
        return { success: true };
      }

      const msg = {
        to: template.to,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@voiceagent.com',
        subject: template.subject,
        text: template.text,
        html: template.html,
      };

      await this.sgMail.send(msg);
      logSafely('info', template, 'Welcome email sent successfully');
      return { success: true };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const template = this.generateWelcomeEmailTemplate(data);
      
      // Secure error logging - never expose sensitive data
      logSafely('error', template, 'Welcome email failed', errorMessage);
      
      // Always return success for welcome emails to prevent blocking user creation
      return { success: true, error: errorMessage };
    }
  }

  async sendSupportTicketNotification(data: SupportTicketEmailData): Promise<{ success: boolean; error?: string }> {
    try {
      // Re-initialize if not configured
      if (!this.isConfigured && !this.sgMail) {
        await this.initialize();
      }
      
      const template = this.generateSupportNotificationTemplate(data);
      
      if (!this.isConfigured || !this.sgMail) {
        logSafely('info', template, 'Support ticket notification queued (SendGrid not configured)');
        return { success: true };
      }

      const msg = {
        to: template.to,
        from: process.env.SENDGRID_FROM_EMAIL || 'support@voiceagent.com',
        subject: template.subject,
        text: template.text,
        html: template.html,
      };

      await this.sgMail.send(msg);
      logSafely('info', template, 'Support ticket notification sent successfully');
      return { success: true };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const template = this.generateSupportNotificationTemplate(data);
      logSafely('error', template, 'Support ticket notification failed', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  async sendPasswordResetEmail(email: string, resetToken: string, resetUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Re-initialize if not configured
      if (!this.isConfigured && !this.sgMail) {
        await this.initialize();
      }
      
      // Escape all user-controlled input to prevent HTML injection
      const safeEmail = escapeHtml(email);
      const safeResetUrl = escapeHtml(resetUrl);
      const safeResetToken = escapeHtml(resetToken);
      
      const subject = 'Password Reset Request - VoiceAgent';
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
            .warning { background: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Password Reset Request</h1>
            <p>Hi,</p>
            <p>You requested a password reset for your VoiceAgent account.</p>
            <div class="warning">
              <p><strong>Reset Token:</strong> <code>${safeResetToken}</code></p>
            </div>
            <p>Click the link below to reset your password:</p>
            <a href="${safeResetUrl}" class="button">Reset Password</a>
            <p>This link will expire in 1 hour for security reasons.</p>
            <p>If you didn't request this reset, please ignore this email.</p>
          </div>
        </body>
        </html>
      `;

      const text = `
Password Reset Request - VoiceAgent

You requested a password reset for your VoiceAgent account.

Reset Token: ${safeResetToken}
Reset URL: ${safeResetUrl}

This link will expire in 1 hour for security reasons.
If you didn't request this reset, please ignore this email.
      `;

      const template: EmailTemplate = {
        to: safeEmail,
        subject,
        html,
        text
      };

      if (!this.isConfigured || !this.sgMail) {
        // Secure logging - never expose reset tokens in logs
        const safeTemplate = {
          to: safeEmail,
          subject,
          contentPreview: 'Password reset with secure token...[MASKED]'
        };
        console.log('[EMAIL] Password reset email queued (SendGrid not configured) | Template:', safeTemplate);
        return { success: true };
      }

      const msg = {
        to: safeEmail,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@voiceagent.com',
        subject,
        text,
        html,
      };

      await this.sgMail.send(msg);
      
      // Secure logging - never expose reset tokens in logs
      const safeTemplate = {
        to: safeEmail,
        subject,
        contentPreview: 'Password reset with secure token...[MASKED]'
      };
      console.log('[EMAIL] Password reset email sent successfully | Template:', safeTemplate);
      return { success: true };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[EMAIL] Failed to send password reset email:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}

export const emailService = EmailService.getInstance();