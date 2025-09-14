import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// German translations
const resources = {
  de: {
    translation: {
      // Navigation
      "dashboard": "Dashboard",
      "customers": "Kunden",
      "bots": "Voice-Bots",
      "billing": "Abrechnung", 
      "support": "Support",
      "settings": "Einstellungen",
      "usage": "Nutzung",
      "logout": "Abmelden",
      
      // Common UI elements
      "loading": "Lädt...",
      "save": "Speichern",
      "cancel": "Abbrechen", 
      "delete": "Löschen",
      "edit": "Bearbeiten",
      "add": "Hinzufügen",
      "create": "Erstellen",
      "update": "Aktualisieren",
      "submit": "Absenden",
      "close": "Schließen",
      "confirm": "Bestätigen",
      "search": "Suchen",
      "filter": "Filter",
      "export": "Exportieren",
      "import": "Importieren",
      "refresh": "Aktualisieren",
      "back": "Zurück",
      "next": "Weiter",
      "previous": "Vorheriger",
      "yes": "Ja",
      "no": "Nein",
      
      // Authentication
      "login": "Anmelden",
      "email": "E-Mail",
      "password": "Passwort",
      "signIn": "Anmelden",
      "signOut": "Abmelden",
      "forgotPassword": "Passwort vergessen?",
      "resetPassword": "Passwort zurücksetzen",
      "newPassword": "Neues Passwort",
      "confirmPassword": "Passwort bestätigen",
      "invalidCredentials": "Ungültige Anmeldedaten",
      "loginSuccess": "Erfolgreich angemeldet",
      "logoutSuccess": "Erfolgreich abgemeldet",
      
      // User Management
      "users": "Benutzer",
      "firstName": "Vorname",
      "lastName": "Nachname", 
      "role": "Rolle",
      "status": "Status",
      "active": "Aktiv",
      "inactive": "Inaktiv",
      "createUser": "Benutzer erstellen",
      "editUser": "Benutzer bearbeiten",
      "deleteUser": "Benutzer löschen",
      "userCreated": "Benutzer erfolgreich erstellt",
      "userUpdated": "Benutzer erfolgreich aktualisiert",
      "userDeleted": "Benutzer erfolgreich gelöscht",
      
      // Tenants/Customers
      "tenant": "Mandant",
      "tenants": "Mandanten",
      "company": "Unternehmen",
      "companyName": "Firmenname",
      "createTenant": "Mandanten erstellen",
      "editTenant": "Mandanten bearbeiten",
      "tenantCreated": "Mandant erfolgreich erstellt",
      "tenantUpdated": "Mandant erfolgreich aktualisiert",
      
      // Voice Bots
      "voiceBot": "Voice-Bot",
      "voiceBots": "Voice-Bots",
      "botName": "Bot-Name", 
      "botStatus": "Bot-Status",
      "ready": "Bereit",
      "pending": "Ausstehend",
      "provisioning": "Bereitstellung",
      "failed": "Fehlgeschlagen",
      "suspended": "Gesperrt",
      "phoneNumber": "Telefonnummer",
      "language": "Sprache",
      "createBot": "Bot erstellen",
      "editBot": "Bot bearbeiten",
      "deleteBot": "Bot löschen",
      "botCreated": "Bot erfolgreich erstellt",
      "botUpdated": "Bot erfolgreich aktualisiert", 
      "botDeleted": "Bot erfolgreich gelöscht",
      "greetingMessage": "Begrüßungsnachricht",
      "voiceBotOnline": "Ihr Voice-Bot ist online und bereit für Anrufe",
      "voiceBotProvisioning": "Voice-Bot-Infrastruktur wird eingerichtet...",
      "voiceBotFailed": "Voice-Bot-Einrichtung fehlgeschlagen. Wenden Sie sich an den Support",
      "voiceBotPending": "Voice-Bot ist zur Bereitstellung eingereiht",
      
      // Billing
      "invoice": "Rechnung",
      "invoices": "Rechnungen",
      "amount": "Betrag",
      "total": "Gesamt",
      "subtotal": "Zwischensumme",
      "tax": "Steuer",
      "paid": "Bezahlt",
      "unpaid": "Unbezahlt",
      "dueDate": "Fälligkeitsdatum",
      "paymentMethod": "Zahlungsmethode",
      "paymentHistory": "Zahlungshistorie",
      "subscription": "Abonnement",
      "plan": "Tarif",
      "currentPlan": "Aktueller Tarif",
      "upgradePlan": "Tarif upgraden",
      "billingAddress": "Rechnungsadresse",
      "invoiceNumber": "Rechnungsnummer",
      
      // Usage & Analytics
      "calls": "Anrufe",
      "minutes": "Minuten",
      "callsCount": "Anzahl Anrufe",
      "totalMinutes": "Gesamtminuten",
      "averageCallDuration": "Durchschnittliche Anrufdauer",
      "usageStatistics": "Nutzungsstatistiken",
      "monthlyUsage": "Monatliche Nutzung",
      "dailyUsage": "Tägliche Nutzung",
      "usageReport": "Nutzungsbericht",
      "thisMonth": "Diesen Monat",
      "lastMonth": "Letzten Monat",
      "thisWeek": "Diese Woche",
      "lastWeek": "Letzte Woche",
      "today": "Heute",
      "yesterday": "Gestern",
      
      // Support
      "ticket": "Ticket",
      "tickets": "Tickets",
      "createTicket": "Ticket erstellen",
      "ticketSubject": "Ticket-Betreff",
      "ticketDescription": "Ticket-Beschreibung",
      "priority": "Priorität",
      "high": "Hoch",
      "medium": "Mittel", 
      "low": "Niedrig",
      "open": "Offen",
      "inProgress": "In Bearbeitung",
      "resolved": "Gelöst",
      "closed": "Geschlossen",
      "assignedTo": "Zugewiesen an",
      "ticketCreated": "Ticket erfolgreich erstellt",
      "ticketUpdated": "Ticket erfolgreich aktualisiert",
      
      // Settings
      "profile": "Profil",
      "account": "Konto",
      "security": "Sicherheit",
      "notifications": "Benachrichtigungen",
      "preferences": "Einstellungen",
      "apiKeys": "API-Schlüssel",
      "integrations": "Integrationen",
      "changePassword": "Passwort ändern",
      "currentPassword": "Aktuelles Passwort",
      "profileUpdated": "Profil erfolgreich aktualisiert",
      "passwordChanged": "Passwort erfolgreich geändert",
      
      // Error Messages
      "error": "Fehler",
      "errorOccurred": "Ein Fehler ist aufgetreten",
      "tryAgain": "Erneut versuchen",
      "somethingWentWrong": "Etwas ist schief gelaufen",
      "notFound": "Nicht gefunden",
      "accessDenied": "Zugriff verweigert",
      "sessionExpired": "Sitzung abgelaufen",
      "networkError": "Netzwerkfehler",
      "validationError": "Validierungsfehler",
      "requiredField": "Dieses Feld ist erforderlich",
      "invalidEmail": "Ungültige E-Mail-Adresse",
      "passwordTooShort": "Passwort zu kurz",
      "passwordsDoNotMatch": "Passwörter stimmen nicht überein",
      
      // Success Messages
      "success": "Erfolgreich",
      "operationSuccessful": "Operation erfolgreich",
      "changesSaved": "Änderungen gespeichert",
      "dataExported": "Daten exportiert",
      "dataImported": "Daten importiert",
      "emailSent": "E-Mail gesendet",
      
      // Time & Dates
      "date": "Datum",
      "time": "Zeit",
      "createdAt": "Erstellt am",
      "updatedAt": "Aktualisiert am",
      "lastUpdated": "Zuletzt aktualisiert",
      "lastLogin": "Letzter Login",
      
      // Actions & Buttons
      "viewDetails": "Details anzeigen",
      "downloadReport": "Bericht herunterladen",
      "generateReport": "Bericht erstellen",
      "sendEmail": "E-Mail senden",
      "makeCall": "Anruf tätigen",
      "testBot": "Bot testen",
      "deployBot": "Bot bereitstellen",
      
      // Dashboard specific
      "welcome": "Willkommen",
      "overview": "Übersicht",
      "recentActivity": "Letzte Aktivitäten",
      "quickActions": "Schnellaktionen",
      "systemStatus": "Systemstatus",
      "allSystems": "Alle Systeme",
      "operational": "Betriebsbereit",
      
      // Platform Admin
      "platformAdmin": "Plattform-Administrator", 
      "systemSettings": "Systemeinstellungen",
      "userManagement": "Benutzerverwaltung",
      "tenantManagement": "Mandantenverwaltung",
      "systemHealth": "Systemgesundheit",
      "auditLogs": "Audit-Protokolle",
      
      // Table Headers
      "name": "Name",
      "actions": "Aktionen",
      "description": "Beschreibung",
      "created": "Erstellt",
      "modified": "Geändert",
      
      // Placeholders
      "enterEmail": "E-Mail eingeben",
      "enterPassword": "Passwort eingeben", 
      "enterName": "Name eingeben",
      "selectOption": "Option auswählen",
      "searchPlaceholder": "Suchen...",
      
      // Confirmations
      "areYouSure": "Sind Sie sicher?",
      "confirmDelete": "Möchten Sie dieses Element wirklich löschen?",
      "confirmAction": "Möchten Sie diese Aktion wirklich ausführen?",
      "cannotBeUndone": "Diese Aktion kann nicht rückgängig gemacht werden",
      
      // German locale specific
      "german": "Deutsch",
      "locale": "de-DE"
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: 'de', // Default to German
    fallbackLng: 'de',
    
    interpolation: {
      escapeValue: false, // React already does escaping
    },
    
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    }
  });

export default i18n;