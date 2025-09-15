import { z } from "zod";

/**
 * Flow Builder System - Comprehensive Flow JSON Schema
 * 
 * This schema defines the structure for voice bot conversation flows with:
 * - Node-based conversation architecture
 * - German language support (de-AT default)
 * - System prompt integration
 * - CRM/Calendar connector integration
 * - Validation rules for flow integrity
 * - Version compatibility support
 */

// Base node interface - all nodes extend this
export const BaseNodeSchema = z.object({
  id: z.string().min(1, "Node ID is required"),
  type: z.enum([
    "start", 
    "say", 
    "listen", 
    "decision", 
    "action", 
    "end",
    "transfer",
    "collect_info",
    "webhook"
  ]),
  label: z.string().min(1, "Node label is required"),
  description: z.string().optional(),
  position: z.object({
    x: z.number(),
    y: z.number()
  }),
  metadata: z.record(z.any()).optional()
});

// Start Node - Entry point of the flow
export const StartNodeSchema = BaseNodeSchema.extend({
  type: z.literal("start"),
  config: z.object({
    greetingMessage: z.string().min(1, "Greeting message is required"),
    locale: z.string().default("de-AT"),
    initialActions: z.array(z.string()).optional() // Node IDs to execute on start
  }),
  connections: z.object({
    next: z.string().min(1, "Start node must connect to next node")
  })
});

// Say Node - Bot speaks to user
export const SayNodeSchema = BaseNodeSchema.extend({
  type: z.literal("say"),
  config: z.object({
    message: z.string().min(1, "Say message is required"),
    voice: z.object({
      provider: z.enum(["elevenlabs", "google", "azure"]).default("elevenlabs"),
      voiceId: z.string().optional(),
      speed: z.number().min(0.5).max(2.0).default(1.0),
      pitch: z.number().min(-20).max(20).default(0)
    }).optional(),
    waitForResponse: z.boolean().default(false),
    timeout: z.number().min(1).max(30).default(5) // seconds
  }),
  connections: z.object({
    next: z.string().optional(),
    timeout: z.string().optional() // Node to go to on timeout
  })
});

// Listen Node - Bot listens for user input
export const ListenNodeSchema = BaseNodeSchema.extend({
  type: z.literal("listen"),
  config: z.object({
    prompt: z.string().optional(), // Optional prompt before listening
    timeout: z.number().min(5).max(60).default(10), // seconds
    maxRetries: z.number().min(0).max(5).default(2),
    retryMessage: z.string().default("Entschuldigung, ich habe Sie nicht verstanden. Könnten Sie das bitte wiederholen?"),
    stt: z.object({
      provider: z.enum(["google", "azure", "whisper"]).default("google"),
      language: z.string().default("de-AT"),
      profanityFilter: z.boolean().default(true)
    }).optional(),
    expectedInputType: z.enum(["speech", "dtmf", "both"]).default("speech"),
    dtmfConfig: z.object({
      terminateOn: z.string().default("#"),
      maxDigits: z.number().min(1).max(20).default(10),
      timeout: z.number().min(1).max(10).default(5)
    }).optional()
  }),
  connections: z.object({
    success: z.string().min(1, "Listen node must have success connection"),
    timeout: z.string().optional(),
    noInput: z.string().optional(),
    error: z.string().optional()
  })
});

// Decision Node - Flow control based on conditions
export const DecisionNodeSchema = BaseNodeSchema.extend({
  type: z.literal("decision"),
  config: z.object({
    conditions: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      logic: z.enum(["contains", "equals", "starts_with", "ends_with", "regex", "intent_match"]),
      value: z.string().min(1),
      caseSensitive: z.boolean().default(false),
      weight: z.number().min(0).max(1).default(1.0) // For ML-based intent matching
    })).min(1, "Decision node must have at least one condition"),
    defaultPath: z.string().min(1, "Decision node must have default path"),
    intent: z.object({
      provider: z.enum(["openai", "google", "custom"]).default("openai"),
      model: z.string().default("gpt-4"),
      systemPrompt: z.string().optional(),
      confidence_threshold: z.number().min(0).max(1).default(0.7)
    }).optional()
  }),
  connections: z.object({
    conditions: z.record(z.string()), // condition.id -> node.id mapping
    default: z.string().min(1, "Decision node must have default connection")
  })
});

// Action Node - Perform external actions (API calls, connectors)
export const ActionNodeSchema = BaseNodeSchema.extend({
  type: z.literal("action"),
  config: z.object({
    actionType: z.enum([
      "api_call", 
      "connector_action", 
      "set_variable", 
      "send_email", 
      "send_sms",
      "schedule_callback",
      "transfer_call"
    ]),
    // API Call configuration
    apiCall: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      url: z.string().url(),
      headers: z.record(z.string()).optional(),
      body: z.record(z.any()).optional(),
      timeout: z.number().min(1).max(30).default(10),
      retries: z.number().min(0).max(3).default(1)
    }).optional(),
    // Connector configuration (CRM/Calendar)
    connector: z.object({
      connectorId: z.string().min(1, "Connector ID is required"),
      action: z.enum([
        "create_contact", 
        "update_contact", 
        "search_contact",
        "create_appointment",
        "check_availability",
        "send_calendar_invite",
        "create_lead",
        "update_opportunity"
      ]),
      parameters: z.record(z.any()),
      mapping: z.record(z.string()).optional() // Map flow variables to connector fields
    }).optional(),
    // Variable manipulation
    variables: z.object({
      set: z.record(z.any()).optional(),
      clear: z.array(z.string()).optional()
    }).optional(),
    // Communication actions
    communication: z.object({
      to: z.string().optional(), // Phone/email - can use variables
      message: z.string().optional(),
      template: z.string().optional(),
      scheduledFor: z.string().optional() // ISO datetime string
    }).optional()
  }),
  connections: z.object({
    success: z.string().min(1, "Action node must have success connection"),
    error: z.string().optional(),
    timeout: z.string().optional()
  })
});

// Collect Info Node - Structured data collection
export const CollectInfoNodeSchema = BaseNodeSchema.extend({
  type: z.literal("collect_info"),
  config: z.object({
    fields: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      type: z.enum(["text", "email", "phone", "date", "number", "choice"]),
      prompt: z.string().min(1),
      required: z.boolean().default(true),
      validation: z.object({
        pattern: z.string().optional(), // Regex pattern
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        min: z.number().optional(), // For numbers
        max: z.number().optional(),
        choices: z.array(z.string()).optional() // For choice type
      }).optional(),
      retryPrompt: z.string().optional(),
      maxRetries: z.number().min(0).max(5).default(2)
    })).min(1, "Collect info node must have at least one field"),
    confirmationPrompt: z.string().optional(),
    allowCorrections: z.boolean().default(true)
  }),
  connections: z.object({
    success: z.string().min(1, "Collect info node must have success connection"),
    incomplete: z.string().optional(),
    error: z.string().optional()
  })
});

// Transfer Node - Transfer call to human or another number
export const TransferNodeSchema = BaseNodeSchema.extend({
  type: z.literal("transfer"),
  config: z.object({
    transferType: z.enum(["warm", "cold", "conference"]),
    destination: z.string().min(1, "Transfer destination is required"), // Phone number or queue
    message: z.string().optional(), // Message before transfer
    timeout: z.number().min(10).max(300).default(30), // seconds
    musicOnHold: z.boolean().default(true),
    recordTransfer: z.boolean().default(false)
  }),
  connections: z.object({
    completed: z.string().optional(),
    failed: z.string().optional(),
    timeout: z.string().optional()
  })
});

// Webhook Node - Send data to external webhooks
export const WebhookNodeSchema = BaseNodeSchema.extend({
  type: z.literal("webhook"),
  config: z.object({
    url: z.string().url("Valid webhook URL is required"),
    method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
    headers: z.record(z.string()).optional(),
    payload: z.record(z.any()),
    timeout: z.number().min(1).max(30).default(10),
    retries: z.number().min(0).max(3).default(1),
    retryDelay: z.number().min(1).max(60).default(5) // seconds
  }),
  connections: z.object({
    success: z.string().optional(),
    error: z.string().optional()
  })
});

// End Node - Terminates the flow
export const EndNodeSchema = BaseNodeSchema.extend({
  type: z.literal("end"),
  config: z.object({
    message: z.string().optional(), // Final message before ending
    reason: z.enum(["completed", "transferred", "error", "timeout", "user_hangup"]).default("completed"),
    postCallActions: z.array(z.object({
      type: z.enum(["send_email", "send_sms", "webhook", "connector_action"]),
      config: z.record(z.any())
    })).optional()
  }),
  connections: z.object({}) // End nodes have no outgoing connections
});

// Union of all node types
export const FlowNodeSchema = z.discriminatedUnion("type", [
  StartNodeSchema,
  SayNodeSchema,
  ListenNodeSchema,
  DecisionNodeSchema,
  ActionNodeSchema,
  CollectInfoNodeSchema,
  TransferNodeSchema,
  WebhookNodeSchema,
  EndNodeSchema
]);

// Flow variable definition
export const FlowVariableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "phone", "email"]),
  defaultValue: z.any().optional(),
  description: z.string().optional(),
  scope: z.enum(["flow", "session", "global"]).default("flow"),
  persist: z.boolean().default(false) // Whether to save to customer profile
});

// Flow metadata and configuration
export const FlowConfigSchema = z.object({
  // System integration
  systemPrompt: z.string().min(10, "System prompt must be at least 10 characters"),
  locale: z.string().default("de-AT"),
  timezone: z.string().default("Europe/Vienna"),
  
  // Voice configuration
  voice: z.object({
    provider: z.enum(["elevenlabs", "google", "azure"]).default("elevenlabs"),
    voiceId: z.string().optional(),
    speed: z.number().min(0.5).max(2.0).default(1.0),
    pitch: z.number().min(-20).max(20).default(0)
  }),
  
  // STT configuration
  stt: z.object({
    provider: z.enum(["google", "azure", "whisper"]).default("google"),
    language: z.string().default("de-AT"),
    profanityFilter: z.boolean().default(true)
  }),
  
  // Flow behavior
  maxDuration: z.number().min(60).max(3600).default(1800), // 30 minutes default
  maxTurns: z.number().min(5).max(100).default(50),
  enableRecording: z.boolean().default(false),
  enableTranscription: z.boolean().default(true),
  
  // Error handling
  errorHandling: z.object({
    maxRetries: z.number().min(0).max(5).default(3),
    fallbackMessage: z.string().default("Es tut mir leid, es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es später erneut."),
    transferOnError: z.boolean().default(false),
    transferNumber: z.string().optional()
  }),
  
  // Connector integration
  connectors: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(["crm", "calendar"]),
    required: z.boolean().default(false)
  })).optional(),
  
  // Template variables (for flow templates)
  templateVariables: z.record(z.object({
    type: z.enum(["string", "number", "boolean"]),
    defaultValue: z.any(),
    description: z.string()
  })).optional()
});

// Complete Flow JSON Schema
export const FlowJsonSchema = z.object({
  // Schema version for compatibility
  schemaVersion: z.string().default("1.0.0"),
  
  // Flow metadata
  metadata: z.object({
    name: z.string().min(1, "Flow name is required"),
    description: z.string().optional(),
    version: z.string().default("1.0.0"),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    lastModified: z.string().datetime().optional()
  }),
  
  // Flow configuration
  config: FlowConfigSchema,
  
  // Flow variables
  variables: z.array(FlowVariableSchema).optional(),
  
  // Flow nodes
  nodes: z.array(FlowNodeSchema).min(2, "Flow must have at least start and end nodes"),
  
  // Validation metadata
  validation: z.object({
    isValid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    lastValidated: z.string().datetime().optional()
  }).optional()
});

// Type exports
export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type StartNode = z.infer<typeof StartNodeSchema>;
export type SayNode = z.infer<typeof SayNodeSchema>;
export type ListenNode = z.infer<typeof ListenNodeSchema>;
export type DecisionNode = z.infer<typeof DecisionNodeSchema>;
export type ActionNode = z.infer<typeof ActionNodeSchema>;
export type CollectInfoNode = z.infer<typeof CollectInfoNodeSchema>;
export type TransferNode = z.infer<typeof TransferNodeSchema>;
export type WebhookNode = z.infer<typeof WebhookNodeSchema>;
export type EndNode = z.infer<typeof EndNodeSchema>;
export type FlowVariable = z.infer<typeof FlowVariableSchema>;
export type FlowConfig = z.infer<typeof FlowConfigSchema>;
export type FlowJson = z.infer<typeof FlowJsonSchema>;

/**
 * Flow validation utilities
 */
export class FlowValidator {
  static validateFlow(flowJson: unknown): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      // Schema validation
      const result = FlowJsonSchema.safeParse(flowJson);
      if (!result.success) {
        errors.push(...result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`));
        return { isValid: false, errors, warnings };
      }
      
      const flow = result.data;
      
      // Flow structure validation
      const startNodes = flow.nodes.filter(n => n.type === 'start');
      if (startNodes.length === 0) {
        errors.push("Flow must have exactly one start node");
      } else if (startNodes.length > 1) {
        errors.push("Flow can only have one start node");
      }
      
      const endNodes = flow.nodes.filter(n => n.type === 'end');
      if (endNodes.length === 0) {
        warnings.push("Flow should have at least one end node");
      }
      
      // Connection validation
      const nodeIds = new Set(flow.nodes.map(n => n.id));
      flow.nodes.forEach(node => {
        Object.values(node.connections || {}).forEach(connectionId => {
          if (typeof connectionId === 'string' && connectionId && !nodeIds.has(connectionId)) {
            errors.push(`Node '${node.id}' connects to non-existent node '${connectionId}'`);
          }
        });
      });
      
      // Reachability validation
      const reachable = this.findReachableNodes(flow.nodes);
      const unreachableNodes = flow.nodes.filter(n => n.type !== 'start' && !reachable.has(n.id));
      if (unreachableNodes.length > 0) {
        warnings.push(`Unreachable nodes: ${unreachableNodes.map(n => n.id).join(', ')}`);
      }
      
      return { isValid: errors.length === 0, errors, warnings };
    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { isValid: false, errors, warnings };
    }
  }
  
  private static findReachableNodes(nodes: FlowNode[]): Set<string> {
    const reachable = new Set<string>();
    const startNode = nodes.find(n => n.type === 'start');
    
    if (!startNode) return reachable;
    
    const queue = [startNode.id];
    reachable.add(startNode.id);
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = nodes.find(n => n.id === currentId);
      
      if (currentNode?.connections) {
        Object.values(currentNode.connections).forEach(nextId => {
          if (typeof nextId === 'string' && nextId && !reachable.has(nextId)) {
            reachable.add(nextId);
            queue.push(nextId);
          }
        });
      }
    }
    
    return reachable;
  }
}

/**
 * Flow template utilities for common patterns
 */
export class FlowTemplates {
  static createBasicGreetingFlow(options: {
    companyName: string;
    greetingMessage?: string;
    systemPrompt?: string;
  }): FlowJson {
    return {
      schemaVersion: "1.0.0",
      metadata: {
        name: `${options.companyName} Begrüßungsflow`,
        description: "Einfacher Begrüßungsflow für Kundenanrufe",
        version: "1.0.0",
        tags: ["greeting", "basic"]
      },
      config: {
        systemPrompt: options.systemPrompt || `Du bist ein freundlicher Telefonassistent für ${options.companyName}. Antworte höflich und professionell auf Deutsch.`,
        locale: "de-AT",
        timezone: "Europe/Vienna",
        voice: {
          provider: "elevenlabs",
          speed: 1.0,
          pitch: 0
        },
        stt: {
          provider: "google",
          language: "de-AT",
          profanityFilter: true
        },
        maxDuration: 1800,
        maxTurns: 50,
        enableRecording: false,
        enableTranscription: true,
        errorHandling: {
          maxRetries: 3,
          fallbackMessage: "Es tut mir leid, es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es später erneut.",
          transferOnError: false
        }
      },
      nodes: [
        {
          id: "start_001",
          type: "start",
          label: "Start",
          position: { x: 100, y: 100 },
          config: {
            greetingMessage: options.greetingMessage || `Guten Tag! Vielen Dank für Ihren Anruf bei ${options.companyName}. Wie kann ich Ihnen heute helfen?`,
            locale: "de-AT"
          },
          connections: {
            next: "listen_001"
          }
        },
        {
          id: "listen_001",
          type: "listen",
          label: "Anfrage anhören",
          position: { x: 300, y: 100 },
          config: {
            timeout: 10,
            maxRetries: 2,
            retryMessage: "Entschuldigung, ich habe Sie nicht verstanden. Könnten Sie das bitte wiederholen?",
            stt: {
              provider: "google",
              language: "de-AT",
              profanityFilter: true
            },
            expectedInputType: "speech"
          },
          connections: {
            success: "end_001",
            timeout: "end_001",
            noInput: "end_001"
          }
        },
        {
          id: "end_001",
          type: "end",
          label: "Ende",
          position: { x: 500, y: 100 },
          config: {
            message: "Vielen Dank für Ihren Anruf. Auf Wiederhören!",
            reason: "completed"
          },
          connections: {}
        }
      ]
    };
  }
}