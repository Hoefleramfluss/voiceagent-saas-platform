import { useState, useCallback, useRef, DragEvent } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import CustomerSidebar from '@/components/customer-sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Connection,
  ReactFlowProvider,
  ReactFlowInstance,
  MarkerType,
  Handle,
  Position,
  NodeProps,
  NodeTypes
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Bot,
  Save,
  Play,
  Plus,
  MessageSquare,
  Ear,
  GitBranch,
  Zap,
  Phone,
  Info,
  Globe,
  ArrowUp,
  Edit,
  Trash,
  ArrowUpCircle
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { 
  FlowsResponse, 
  FlowVersionsResponse, 
  FlowData, 
  FlowVersion,
  CreateFlowRequest,
  UpdateFlowRequest,
  PromoteVersionRequest
} from '@shared/api-types';
import { 
  FlowNodeSchema,
  FlowJsonSchema,
  BaseNodeSchema
} from '@shared/flow-schema';
import { z } from 'zod';

// Node type configurations
const nodeTypes = [
  { type: 'start', label: 'Start', icon: Play, color: 'bg-green-100 border-green-300 text-green-800' },
  { type: 'say', label: 'Sprechen', icon: MessageSquare, color: 'bg-blue-100 border-blue-300 text-blue-800' },
  { type: 'listen', label: 'Zuhören', icon: Ear, color: 'bg-purple-100 border-purple-300 text-purple-800' },
  { type: 'decision', label: 'Entscheidung', icon: GitBranch, color: 'bg-yellow-100 border-yellow-300 text-yellow-800' },
  { type: 'action', label: 'Aktion', icon: Zap, color: 'bg-orange-100 border-orange-300 text-orange-800' },
  { type: 'transfer', label: 'Weiterleitung', icon: Phone, color: 'bg-red-100 border-red-300 text-red-800' },
  { type: 'collect_info', label: 'Info sammeln', icon: Info, color: 'bg-indigo-100 border-indigo-300 text-indigo-800' },
  { type: 'webhook', label: 'Webhook', icon: Globe, color: 'bg-gray-100 border-gray-300 text-gray-800' },
  { type: 'end', label: 'Ende', icon: Bot, color: 'bg-gray-200 border-gray-400 text-gray-900' }
];

// Custom Node Component with proper handles
function CustomNode({ data, selected }: NodeProps) {
  const nodeConfig = nodeTypes.find(n => n.type === data.type);
  const Icon = nodeConfig?.icon || Bot;
  
  // Determine which handles to show based on node type
  const showTargetHandle = data.type !== 'start';
  const showSourceHandle = data.type !== 'end';
  
  return (
    <div className={`px-4 py-2 shadow-md rounded-md border-2 ${nodeConfig?.color || 'bg-white border-gray-300'} ${selected ? 'ring-2 ring-primary' : ''}`}>
      {showTargetHandle && (
        <Handle
          type="target"
          position={Position.Top}
          className="w-2 h-2 bg-gray-400"
        />
      )}
      
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        <div>
          <div className="text-sm font-bold">{data.label}</div>
          {data.description && <div className="text-xs opacity-70">{data.description}</div>}
        </div>
      </div>
      
      {showSourceHandle && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="w-2 h-2 bg-gray-400"
        />
      )}
      
      {/* Multiple handles for decision nodes */}
      {data.type === 'decision' && data.config?.conditions && (
        <>
          {data.config.conditions.map((condition: any, index: number) => (
            <Handle
              key={condition.id}
              type="source"
              position={Position.Right}
              id={condition.id}
              className="w-2 h-2 bg-yellow-400"
              style={{ top: `${30 + index * 20}px` }}
            />
          ))}
          <Handle
            type="source"
            position={Position.Bottom}
            id="default"
            className="w-2 h-2 bg-gray-400"
          />
        </>
      )}
    </div>
  );
}

// Define node types for React Flow
const nodeTypesMap: NodeTypes = {
  flowNode: CustomNode
};

// Node Palette Component with drag-and-drop
function NodePalette() {
  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Card className="w-64">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Knoten hinzufügen
        </CardTitle>
        <CardDescription>Drag & Drop um Flow zu erstellen</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {nodeTypes.map((nodeType) => {
            const Icon = nodeType.icon;
            return (
              <div
                key={nodeType.type}
                className="flex items-center gap-2 p-3 border rounded-md cursor-grab hover:bg-muted/50 transition-colors"
                draggable
                onDragStart={(event) => onDragStart(event, nodeType.type)}
                data-testid={`drag-node-${nodeType.type}`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{nodeType.label}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Node Editor Dialog
function NodeEditor({ 
  node, 
  isOpen, 
  onClose, 
  onSave 
}: { 
  node: Node | null; 
  isOpen: boolean; 
  onClose: () => void; 
  onSave: (node: Node) => void;
}) {
  const [nodeData, setNodeData] = useState(node?.data || {});
  
  if (!node) return null;

  const handleSave = () => {
    const updatedNode = {
      ...node,
      data: {
        ...node.data,
        ...nodeData,
        label: nodeData.label || node.data.label
      }
    };
    onSave(updatedNode);
    onClose();
  };

  const renderConfigEditor = () => {
    switch (node.data.type) {
      case 'start':
        return (
          <div className="space-y-4">
            <div>
              <Label>Begrüßungsnachricht</Label>
              <Textarea
                value={nodeData.config?.greetingMessage || ''}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, greetingMessage: e.target.value }
                }))}
                placeholder="Guten Tag! Wie kann ich Ihnen helfen?"
                data-testid="input-start-greeting"
              />
            </div>
            <div>
              <Label>Sprache</Label>
              <Select 
                value={nodeData.config?.locale || 'de-AT'}
                onValueChange={(value) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, locale: value }
                }))}
              >
                <SelectTrigger data-testid="select-start-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="de-AT">Deutsch (Österreich)</SelectItem>
                  <SelectItem value="de-DE">Deutsch (Deutschland)</SelectItem>
                  <SelectItem value="en-US">English (US)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      case 'say':
        return (
          <div className="space-y-4">
            <div>
              <Label>Nachricht</Label>
              <Textarea
                value={nodeData.config?.message || ''}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, message: e.target.value }
                }))}
                placeholder="Nachricht eingeben..."
                data-testid="input-say-message"
              />
            </div>
            <div>
              <Label>Geschwindigkeit</Label>
              <Input
                type="number"
                min="0.5"
                max="2.0"
                step="0.1"
                value={nodeData.config?.voice?.speed || 1.0}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { 
                    ...prev.config, 
                    voice: { ...prev.config?.voice, speed: parseFloat(e.target.value) }
                  }
                }))}
                data-testid="input-say-speed"
              />
            </div>
          </div>
        );
      
      case 'listen':
        return (
          <div className="space-y-4">
            <div>
              <Label>Aufforderung</Label>
              <Input
                value={nodeData.config?.prompt || ''}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, prompt: e.target.value }
                }))}
                placeholder="Aufforderung eingeben..."
                data-testid="input-listen-prompt"
              />
            </div>
            <div>
              <Label>Timeout (Sekunden)</Label>
              <Input
                type="number"
                value={nodeData.config?.timeout || 10}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, timeout: parseInt(e.target.value) }
                }))}
                data-testid="input-listen-timeout"
              />
            </div>
            <div>
              <Label>Max. Wiederholungen</Label>
              <Input
                type="number"
                min="0"
                max="5"
                value={nodeData.config?.maxRetries || 2}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, maxRetries: parseInt(e.target.value) }
                }))}
                data-testid="input-listen-retries"
              />
            </div>
          </div>
        );
      
      case 'decision':
        return (
          <div className="space-y-4">
            <Label>Bedingungen</Label>
            {(nodeData.config?.conditions || []).map((condition: any, index: number) => (
              <div key={condition.id} className="border p-3 rounded space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Bedingung Name"
                    value={condition.name || ''}
                    onChange={(e) => {
                      const newConditions = [...(nodeData.config?.conditions || [])];
                      newConditions[index] = { ...condition, name: e.target.value };
                      setNodeData(prev => ({
                        ...prev,
                        config: { ...prev.config, conditions: newConditions }
                      }));
                    }}
                    data-testid={`input-condition-name-${index}`}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newConditions = (nodeData.config?.conditions || []).filter((_: any, i: number) => i !== index);
                      setNodeData(prev => ({
                        ...prev,
                        config: { ...prev.config, conditions: newConditions }
                      }));
                    }}
                    data-testid={`button-remove-condition-${index}`}
                  >
                    <Trash className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select 
                    value={condition.logic || 'contains'}
                    onValueChange={(value) => {
                      const newConditions = [...(nodeData.config?.conditions || [])];
                      newConditions[index] = { ...condition, logic: value };
                      setNodeData(prev => ({
                        ...prev,
                        config: { ...prev.config, conditions: newConditions }
                      }));
                    }}
                  >
                    <SelectTrigger data-testid={`select-condition-logic-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">Enthält</SelectItem>
                      <SelectItem value="equals">Ist gleich</SelectItem>
                      <SelectItem value="starts_with">Beginnt mit</SelectItem>
                      <SelectItem value="ends_with">Endet mit</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Wert"
                    value={condition.value || ''}
                    onChange={(e) => {
                      const newConditions = [...(nodeData.config?.conditions || [])];
                      newConditions[index] = { ...condition, value: e.target.value };
                      setNodeData(prev => ({
                        ...prev,
                        config: { ...prev.config, conditions: newConditions }
                      }));
                    }}
                    data-testid={`input-condition-value-${index}`}
                  />
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newCondition = { 
                  id: uuidv4(), 
                  name: `Bedingung ${(nodeData.config?.conditions?.length || 0) + 1}`, 
                  logic: 'contains', 
                  value: '', 
                  caseSensitive: false, 
                  weight: 1.0 
                };
                setNodeData(prev => ({
                  ...prev,
                  config: { 
                    ...prev.config, 
                    conditions: [...(prev.config?.conditions || []), newCondition] 
                  }
                }));
              }}
              data-testid="button-add-condition"
            >
              <Plus className="w-4 h-4 mr-2" />
              Bedingung hinzufügen
            </Button>
          </div>
        );
      
      case 'action':
        return (
          <div className="space-y-4">
            <div>
              <Label>Aktionstyp</Label>
              <Select 
                value={nodeData.config?.actionType || 'api_call'}
                onValueChange={(value) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, actionType: value }
                }))}
              >
                <SelectTrigger data-testid="select-action-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api_call">API Aufruf</SelectItem>
                  <SelectItem value="set_variable">Variable setzen</SelectItem>
                  <SelectItem value="send_email">E-Mail senden</SelectItem>
                  <SelectItem value="send_sms">SMS senden</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {nodeData.config?.actionType === 'api_call' && (
              <div className="space-y-3">
                <div>
                  <Label>URL</Label>
                  <Input
                    value={nodeData.config?.apiCall?.url || ''}
                    onChange={(e) => setNodeData(prev => ({
                      ...prev,
                      config: { 
                        ...prev.config, 
                        apiCall: { ...prev.config?.apiCall, url: e.target.value }
                      }
                    }))}
                    placeholder="https://api.example.com/endpoint"
                    data-testid="input-api-url"
                  />
                </div>
                <div>
                  <Label>HTTP Method</Label>
                  <Select 
                    value={nodeData.config?.apiCall?.method || 'POST'}
                    onValueChange={(value) => setNodeData(prev => ({
                      ...prev,
                      config: { 
                        ...prev.config, 
                        apiCall: { ...prev.config?.apiCall, method: value }
                      }
                    }))}
                  >
                    <SelectTrigger data-testid="select-api-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        );
      
      case 'transfer':
        return (
          <div className="space-y-4">
            <div>
              <Label>Transfer-Typ</Label>
              <Select 
                value={nodeData.config?.transferType || 'warm'}
                onValueChange={(value) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, transferType: value }
                }))}
              >
                <SelectTrigger data-testid="select-transfer-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warm">Warm Transfer</SelectItem>
                  <SelectItem value="cold">Cold Transfer</SelectItem>
                  <SelectItem value="conference">Konferenz</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Zielrufnummer</Label>
              <Input
                value={nodeData.config?.destination || ''}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, destination: e.target.value }
                }))}
                placeholder="+431234567890"
                data-testid="input-transfer-destination"
              />
            </div>
            <div>
              <Label>Übertragungsnachricht</Label>
              <Textarea
                value={nodeData.config?.message || ''}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, message: e.target.value }
                }))}
                placeholder="Ich verbinde Sie weiter..."
                data-testid="input-transfer-message"
              />
            </div>
            <div>
              <Label>Timeout (Sekunden)</Label>
              <Input
                type="number"
                min="10"
                max="300"
                value={nodeData.config?.timeout || 30}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, timeout: parseInt(e.target.value) }
                }))}
                data-testid="input-transfer-timeout"
              />
            </div>
          </div>
        );
      
      case 'collect_info':
        return (
          <div className="space-y-4">
            <Label>Felder zum Sammeln</Label>
            {(nodeData.config?.fields || []).map((field: any, index: number) => (
              <div key={field.id} className="border p-3 rounded space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Feldname"
                    value={field.name || ''}
                    onChange={(e) => {
                      const newFields = [...(nodeData.config?.fields || [])];
                      newFields[index] = { ...field, name: e.target.value };
                      setNodeData(prev => ({
                        ...prev,
                        config: { ...prev.config, fields: newFields }
                      }));
                    }}
                    data-testid={`input-field-name-${index}`}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newFields = (nodeData.config?.fields || []).filter((_: any, i: number) => i !== index);
                      setNodeData(prev => ({
                        ...prev,
                        config: { ...prev.config, fields: newFields }
                      }));
                    }}
                    data-testid={`button-remove-field-${index}`}
                  >
                    <Trash className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select 
                    value={field.type || 'text'}
                    onValueChange={(value) => {
                      const newFields = [...(nodeData.config?.fields || [])];
                      newFields[index] = { ...field, type: value };
                      setNodeData(prev => ({
                        ...prev,
                        config: { ...prev.config, fields: newFields }
                      }));
                    }}
                  >
                    <SelectTrigger data-testid={`select-field-type-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="email">E-Mail</SelectItem>
                      <SelectItem value="phone">Telefon</SelectItem>
                      <SelectItem value="date">Datum</SelectItem>
                      <SelectItem value="number">Zahl</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={field.required || false}
                      onChange={(e) => {
                        const newFields = [...(nodeData.config?.fields || [])];
                        newFields[index] = { ...field, required: e.target.checked };
                        setNodeData(prev => ({
                          ...prev,
                          config: { ...prev.config, fields: newFields }
                        }));
                      }}
                      data-testid={`checkbox-field-required-${index}`}
                    />
                    <Label className="text-sm">Erforderlich</Label>
                  </div>
                </div>
                <Input
                  placeholder="Prompt für dieses Feld"
                  value={field.prompt || ''}
                  onChange={(e) => {
                    const newFields = [...(nodeData.config?.fields || [])];
                    newFields[index] = { ...field, prompt: e.target.value };
                    setNodeData(prev => ({
                      ...prev,
                      config: { ...prev.config, fields: newFields }
                    }));
                  }}
                  data-testid={`input-field-prompt-${index}`}
                />
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newField = { 
                  id: uuidv4(), 
                  name: `field_${(nodeData.config?.fields?.length || 0) + 1}`, 
                  type: 'text', 
                  prompt: 'Bitte geben Sie die Information ein', 
                  required: true 
                };
                setNodeData(prev => ({
                  ...prev,
                  config: { 
                    ...prev.config, 
                    fields: [...(prev.config?.fields || []), newField] 
                  }
                }));
              }}
              data-testid="button-add-field"
            >
              <Plus className="w-4 h-4 mr-2" />
              Feld hinzufügen
            </Button>
          </div>
        );
      
      case 'webhook':
        return (
          <div className="space-y-4">
            <div>
              <Label>Webhook URL</Label>
              <Input
                value={nodeData.config?.url || ''}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, url: e.target.value }
                }))}
                placeholder="https://api.example.com/webhook"
                data-testid="input-webhook-url"
              />
            </div>
            <div>
              <Label>HTTP Method</Label>
              <Select 
                value={nodeData.config?.method || 'POST'}
                onValueChange={(value) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, method: value }
                }))}
              >
                <SelectTrigger data-testid="select-webhook-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Timeout (Sekunden)</Label>
              <Input
                type="number"
                min="1"
                max="30"
                value={nodeData.config?.timeout || 10}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, timeout: parseInt(e.target.value) }
                }))}
                data-testid="input-webhook-timeout"
              />
            </div>
            <div>
              <Label>Wiederholungen bei Fehler</Label>
              <Input
                type="number"
                min="0"
                max="3"
                value={nodeData.config?.retries || 1}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, retries: parseInt(e.target.value) }
                }))}
                data-testid="input-webhook-retries"
              />
            </div>
          </div>
        );
      
      case 'end':
        return (
          <div className="space-y-4">
            <div>
              <Label>Abschlussnachricht</Label>
              <Textarea
                value={nodeData.config?.message || ''}
                onChange={(e) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, message: e.target.value }
                }))}
                placeholder="Vielen Dank für Ihren Anruf. Auf Wiederhören!"
                data-testid="input-end-message"
              />
            </div>
            <div>
              <Label>Grund für Beendigung</Label>
              <Select 
                value={nodeData.config?.reason || 'completed'}
                onValueChange={(value) => setNodeData(prev => ({
                  ...prev,
                  config: { ...prev.config, reason: value }
                }))}
              >
                <SelectTrigger data-testid="select-end-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Erfolgreich abgeschlossen</SelectItem>
                  <SelectItem value="transferred">Weitergeleitet</SelectItem>
                  <SelectItem value="error">Fehler aufgetreten</SelectItem>
                  <SelectItem value="timeout">Timeout</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      default:
        return <div>Editor für {node.data.type} ist noch nicht implementiert.</div>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Node bearbeiten: {node.data.label}</DialogTitle>
          <DialogDescription>
            Konfigurieren Sie die Eigenschaften dieses Knotens
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label>Label</Label>
            <Input
              value={nodeData.label || node.data.label}
              onChange={(e) => setNodeData(prev => ({ ...prev, label: e.target.value }))}
              data-testid="input-node-label"
            />
          </div>
          
          <div>
            <Label>Beschreibung</Label>
            <Input
              value={nodeData.description || ''}
              onChange={(e) => setNodeData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Optional..."
              data-testid="input-node-description"
            />
          </div>
          
          {renderConfigEditor()}
          
          <div className="flex gap-2 pt-4">
            <Button onClick={handleSave} data-testid="button-save-node">
              Speichern
            </Button>
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-node">
              Abbrechen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Main Flow Builder Component
function FlowBuilderContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  
  // Flow state
  const [selectedFlow, setSelectedFlow] = useState<string>('');
  const [flowName, setFlowName] = useState('');
  const [flowDescription, setFlowDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('Sie sind ein hilfsbereit Assistent. Seien Sie höflich, professionell und helfen Sie Benutzern bei ihren Anfragen bestmöglich.');
  const [isCreateFlowOpen, setIsCreateFlowOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isNodeEditOpen, setIsNodeEditOpen] = useState(false);
  
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // API queries with proper types
  const { data: flowsData, isLoading: flowsLoading } = useQuery<FlowsResponse>({
    queryKey: ['/api/flows'],
    enabled: !!user?.tenantId
  });

  const { data: versionsData, isLoading: versionsLoading } = useQuery<FlowVersionsResponse>({
    queryKey: ['/api/flows', selectedFlow, 'versions'],
    enabled: !!selectedFlow
  });

  // Mutations with proper error handling
  const createFlowMutation = useMutation({
    mutationFn: async (data: CreateFlowRequest) => {
      return apiRequest('POST', '/api/flows', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flows'] });
      toast({ title: 'Flow erstellt', description: 'Neuer Flow wurde erfolgreich erstellt' });
      setIsCreateFlowOpen(false);
      setFlowName('');
      setFlowDescription('');
    },
    onError: (error: any) => {
      toast({ title: 'Fehler', description: error.message || 'Flow konnte nicht erstellt werden', variant: 'destructive' });
    }
  });

  const updateFlowMutation = useMutation({
    mutationFn: async ({ flowId, data }: { flowId: string; data: UpdateFlowRequest }) => {
      return apiRequest('PUT', `/api/flows/${flowId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flows'] });
      queryClient.invalidateQueries({ queryKey: ['/api/flows', selectedFlow, 'versions'] });
      toast({ title: 'Flow gespeichert', description: 'Änderungen wurden erfolgreich gespeichert' });
    },
    onError: (error: any) => {
      toast({ title: 'Fehler', description: error.message || 'Flow konnte nicht gespeichert werden', variant: 'destructive' });
    }
  });

  const promoteVersionMutation = useMutation({
    mutationFn: async ({ flowId, versionId, targetStage }: { flowId: string; versionId: string; targetStage: string }) => {
      return apiRequest('POST', `/api/flows/${flowId}/versions/${versionId}/promote`, { targetStage });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flows'] });
      queryClient.invalidateQueries({ queryKey: ['/api/flows', selectedFlow, 'versions'] });
      toast({ title: 'Flow promoted', description: 'Flow wurde erfolgreich promoted' });
    },
    onError: (error: any) => {
      toast({ title: 'Fehler', description: error.message || 'Flow konnte nicht promoted werden', variant: 'destructive' });
    }
  });

  // Flow Builder functions
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow');

      if (typeof type === 'undefined' || !type || !reactFlowInstance || !reactFlowBounds) {
        return;
      }

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const nodeConfig = nodeTypes.find(n => n.type === type);
      const newNode: Node = {
        id: uuidv4(),
        type: 'flowNode',
        position,
        data: { 
          label: nodeConfig?.label || type,
          type,
          config: getDefaultNodeConfig(type)
        }
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  const getDefaultNodeConfig = (type: string) => {
    switch (type) {
      case 'start':
        return { greetingMessage: 'Guten Tag! Wie kann ich Ihnen helfen?', locale: 'de-AT' };
      case 'say':
        return { message: 'Hallo, ich bin Ihr virtueller Assistent.' };
      case 'listen':
        return { prompt: 'Bitte sprechen Sie nach dem Ton.', timeout: 10 };
      case 'decision':
        return { conditions: [{ id: uuidv4(), name: 'Ja', logic: 'contains', value: 'ja', caseSensitive: false, weight: 1.0 }], defaultPath: '' };
      case 'action':
        return { actionType: 'api_call', apiCall: { method: 'POST', url: 'https://api.example.com', timeout: 10, retries: 1 } };
      case 'transfer':
        return { transferType: 'warm', destination: '+43', message: 'Ich verbinde Sie weiter.', timeout: 30 };
      case 'collect_info':
        return { fields: [{ id: uuidv4(), name: 'name', type: 'text', prompt: 'Wie ist Ihr Name?', required: true }] };
      case 'webhook':
        return { url: 'https://api.example.com/webhook', method: 'POST', payload: {}, timeout: 10, retries: 1 };
      default:
        return {};
    }
  };

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setIsNodeEditOpen(true);
  }, []);

  const onNodeSave = useCallback((updatedNode: Node) => {
    setNodes((nds) => nds.map(node => node.id === updatedNode.id ? updatedNode : node));
  }, [setNodes]);

  const validateFlow = () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if flow has nodes
    if (nodes.length === 0) {
      errors.push('Flow muss mindestens einen Knoten enthalten');
      return { isValid: false, errors, warnings };
    }

    // Find start and end nodes
    const startNodes = nodes.filter(node => node.data.type === 'start');
    const endNodes = nodes.filter(node => node.data.type === 'end');

    // Validate structural requirements
    if (startNodes.length === 0) {
      errors.push('Flow muss genau einen Start-Knoten haben');
    } else if (startNodes.length > 1) {
      errors.push('Flow kann nur einen Start-Knoten haben');
    }

    if (endNodes.length === 0) {
      warnings.push('Flow sollte mindestens einen End-Knoten haben');
    }

    // Validate each node
    nodes.forEach(node => {
      const nodeErrors = validateNode(node);
      if (nodeErrors.length > 0) {
        errors.push(`Knoten "${node.data.label}" (${node.data.type}): ${nodeErrors.join(', ')}`);
      }
    });

    // Check for orphaned nodes (nodes with no incoming connections, except start nodes)
    const connectedNodeIds = new Set<string>();
    edges.forEach(edge => {
      connectedNodeIds.add(edge.target);
    });

    nodes.forEach(node => {
      if (node.data.type !== 'start' && !connectedNodeIds.has(node.id)) {
        warnings.push(`Knoten "${node.data.label}" hat keine eingehenden Verbindungen`);
      }
    });

    // Create flow data for schema validation
    try {
      const flowData = {
        schemaVersion: "1.0.0",
        metadata: {
          name: flowName || "Unnamed Flow",
          version: "1.0.0",
          description: flowDescription || '',
          lastModified: new Date().toISOString()
        },
        config: {
          systemPrompt,
          locale: 'de-AT',
          timezone: 'Europe/Vienna',
          voice: { 
            provider: 'elevenlabs' as const, 
            speed: 1.0, 
            pitch: 0 
          },
          stt: { 
            provider: 'google' as const, 
            language: 'de-AT', 
            profanityFilter: true 
          },
          maxDuration: 1800,
          maxTurns: 50,
          enableRecording: false,
          enableTranscription: true,
          errorHandling: {
            maxRetries: 3,
            fallbackMessage: 'Es tut mir leid, es ist ein technischer Fehler aufgetreten.',
            transferOnError: false
          }
        },
        variables: [],
        nodes: nodes.map(node => ({
          id: node.id,
          type: node.data.type,
          label: node.data.label,
          description: node.data.description || '',
          position: node.position,
          config: node.data.config || {},
          connections: getNodeConnections(node.id),
          metadata: {}
        })),
        validation: {
          isValid: errors.length === 0,
          errors,
          warnings
        }
      };

      // Validate against schema
      FlowJsonSchema.parse(flowData);
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => {
          const path = err.path.join('.');
          errors.push(`Schema-Fehler bei ${path}: ${err.message}`);
        });
      } else {
        errors.push('Unbekannter Schema-Validierungsfehler');
      }
    }

    return { 
      isValid: errors.length === 0, 
      errors, 
      warnings 
    };
  };

  const validateNode = (node: Node) => {
    const errors: string[] = [];
    const config = node.data.config || {};
    const connections = getNodeConnections(node.id);

    switch (node.data.type) {
      case 'start':
        if (!config.greetingMessage || config.greetingMessage.trim() === '') {
          errors.push('Begrüßungsnachricht ist erforderlich');
        }
        if (!connections.next) {
          errors.push('Start-Knoten muss eine Verbindung zum nächsten Knoten haben');
        }
        break;

      case 'say':
        if (!config.message || config.message.trim() === '') {
          errors.push('Nachricht ist erforderlich');
        }
        break;

      case 'listen':
        if (config.timeout && (config.timeout < 5 || config.timeout > 60)) {
          errors.push('Timeout muss zwischen 5 und 60 Sekunden liegen');
        }
        if (!connections.success) {
          errors.push('Listen-Knoten muss eine Success-Verbindung haben');
        }
        break;

      case 'decision':
        if (!config.conditions || config.conditions.length === 0) {
          errors.push('Decision-Knoten muss mindestens eine Bedingung haben');
        } else {
          config.conditions.forEach((condition: any, index: number) => {
            if (!condition.name || condition.name.trim() === '') {
              errors.push(`Bedingung ${index + 1} benötigt einen Namen`);
            }
            if (!condition.value || condition.value.trim() === '') {
              errors.push(`Bedingung ${index + 1} benötigt einen Wert`);
            }
          });
        }
        if (!connections.default) {
          errors.push('Decision-Knoten muss eine Default-Verbindung haben');
        }
        break;

      case 'action':
        if (!config.actionType) {
          errors.push('Aktionstyp ist erforderlich');
        }
        if (config.actionType === 'api_call') {
          if (!config.apiCall?.url || !config.apiCall.url.trim()) {
            errors.push('API-URL ist erforderlich');
          }
          if (config.apiCall?.url && !isValidUrl(config.apiCall.url)) {
            errors.push('Ungültige API-URL');
          }
        }
        if (!connections.success) {
          errors.push('Action-Knoten muss eine Success-Verbindung haben');
        }
        break;

      case 'transfer':
        if (!config.destination || config.destination.trim() === '') {
          errors.push('Zielrufnummer ist erforderlich');
        }
        if (!config.transferType) {
          errors.push('Transfer-Typ ist erforderlich');
        }
        break;

      case 'collect_info':
        if (!config.fields || config.fields.length === 0) {
          errors.push('Collect Info-Knoten muss mindestens ein Feld haben');
        } else {
          config.fields.forEach((field: any, index: number) => {
            if (!field.name || field.name.trim() === '') {
              errors.push(`Feld ${index + 1} benötigt einen Namen`);
            }
            if (!field.prompt || field.prompt.trim() === '') {
              errors.push(`Feld ${index + 1} benötigt eine Aufforderung`);
            }
          });
        }
        if (!connections.success) {
          errors.push('Collect Info-Knoten muss eine Success-Verbindung haben');
        }
        break;

      case 'webhook':
        if (!config.url || config.url.trim() === '') {
          errors.push('Webhook-URL ist erforderlich');
        }
        if (config.url && !isValidUrl(config.url)) {
          errors.push('Ungültige Webhook-URL');
        }
        break;

      case 'end':
        // End nodes don't require specific validations beyond optional message
        break;

      default:
        errors.push(`Unbekannter Knotentyp: ${node.data.type}`);
        break;
    }

    return errors;
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleCreateFlow = () => {
    const validation = validateFlow();
    if (!validation.isValid) {
      toast({ 
        title: 'Validierungsfehler', 
        description: validation.errors.join(', '), 
        variant: 'destructive' 
      });
      return;
    }

    const flowData: CreateFlowRequest = {
      name: flowName,
      description: flowDescription,
      systemPrompt,
      locale: 'de-AT',
      timezone: 'Europe/Vienna',
      flow: {
        schemaVersion: "1.0.0",
        metadata: {
          name: flowName,
          version: "1.0.0"
        },
        config: {
          systemPrompt,
          locale: 'de-AT',
          timezone: 'Europe/Vienna',
          voice: { provider: 'elevenlabs', speed: 1.0, pitch: 0 },
          stt: { provider: 'google', language: 'de-AT', profanityFilter: true },
          maxDuration: 1800,
          maxTurns: 50,
          enableRecording: false,
          enableTranscription: true,
          errorHandling: {
            maxRetries: 3,
            fallbackMessage: 'Es tut mir leid, es ist ein technischer Fehler aufgetreten.',
            transferOnError: false
          }
        },
        variables: [],
        nodes: nodes.map(node => ({
          id: node.id,
          type: node.data.type,
          label: node.data.label,
          description: node.data.description,
          position: node.position,
          config: node.data.config,
          connections: getNodeConnections(node.id),
          metadata: {}
        })),
        validation: {
          isValid: true,
          errors: [],
          warnings: []
        }
      }
    };

    createFlowMutation.mutate(flowData);
  };

  const handleSaveFlow = () => {
    if (!selectedFlow) return;

    const validation = validateFlow();
    if (!validation.isValid) {
      toast({ 
        title: 'Validierungsfehler', 
        description: validation.errors.join(', '), 
        variant: 'destructive' 
      });
      return;
    }

    const flowData: UpdateFlowRequest = {
      flow: {
        schemaVersion: "1.0.0",
        metadata: {
          name: flowName || currentFlow?.name || "Unnamed Flow",
          version: "1.0.0",
          lastModified: new Date().toISOString()
        },
        config: {
          systemPrompt,
          locale: 'de-AT',
          timezone: 'Europe/Vienna',
          voice: { provider: 'elevenlabs', speed: 1.0, pitch: 0 },
          stt: { provider: 'google', language: 'de-AT', profanityFilter: true },
          maxDuration: 1800,
          maxTurns: 50,
          enableRecording: false,
          enableTranscription: true,
          errorHandling: {
            maxRetries: 3,
            fallbackMessage: 'Es tut mir leid, es ist ein technischer Fehler aufgetreten.',
            transferOnError: false
          }
        },
        variables: [],
        nodes: nodes.map(node => ({
          id: node.id,
          type: node.data.type,
          label: node.data.label,
          description: node.data.description,
          position: node.position,
          config: node.data.config,
          connections: getNodeConnections(node.id),
          metadata: {}
        })),
        validation: {
          isValid: true,
          errors: [],
          warnings: []
        }
      }
    };

    updateFlowMutation.mutate({ flowId: selectedFlow, data: flowData });
  };

  const getNodeConnections = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return {};

    const nodeEdges = edges.filter(edge => edge.source === nodeId);
    const connections: any = {};
    
    // Map edges to connections based on node type and schema requirements
    switch (node.data.type) {
      case 'start':
        // Start nodes require connections.next
        const nextEdge = nodeEdges.find(edge => !edge.sourceHandle || edge.sourceHandle === 'next');
        if (nextEdge) {
          connections.next = nextEdge.target;
        }
        break;

      case 'say':
        // Say nodes can have next and timeout connections
        const sayNextEdge = nodeEdges.find(edge => !edge.sourceHandle || edge.sourceHandle === 'next');
        const timeoutEdge = nodeEdges.find(edge => edge.sourceHandle === 'timeout');
        
        if (sayNextEdge) connections.next = sayNextEdge.target;
        if (timeoutEdge) connections.timeout = timeoutEdge.target;
        break;

      case 'listen':
        // Listen nodes require success connection and optional timeout/noInput/error
        const successEdge = nodeEdges.find(edge => edge.sourceHandle === 'success' || !edge.sourceHandle);
        const listenTimeoutEdge = nodeEdges.find(edge => edge.sourceHandle === 'timeout');
        const noInputEdge = nodeEdges.find(edge => edge.sourceHandle === 'noInput');
        const errorEdge = nodeEdges.find(edge => edge.sourceHandle === 'error');
        
        if (successEdge) connections.success = successEdge.target;
        if (listenTimeoutEdge) connections.timeout = listenTimeoutEdge.target;
        if (noInputEdge) connections.noInput = noInputEdge.target;
        if (errorEdge) connections.error = errorEdge.target;
        break;

      case 'decision':
        // Decision nodes have condition-specific handles and a default connection
        const conditionConnections: Record<string, string> = {};
        const conditions = node.data.config?.conditions || [];
        
        // Map condition-specific edges
        conditions.forEach((condition: any) => {
          const conditionEdge = nodeEdges.find(edge => edge.sourceHandle === condition.id);
          if (conditionEdge) {
            conditionConnections[condition.id] = conditionEdge.target;
          }
        });
        
        // Default connection (typically from bottom handle)
        const defaultEdge = nodeEdges.find(edge => edge.sourceHandle === 'default' || 
          (!edge.sourceHandle && !conditions.some((c: any) => 
            nodeEdges.some(e => e.sourceHandle === c.id))));
        
        if (Object.keys(conditionConnections).length > 0) {
          connections.conditions = conditionConnections;
        }
        if (defaultEdge) {
          connections.default = defaultEdge.target;
        }
        break;

      case 'action':
        // Action nodes need success and optional error/timeout connections
        const actionSuccessEdge = nodeEdges.find(edge => edge.sourceHandle === 'success' || !edge.sourceHandle);
        const actionErrorEdge = nodeEdges.find(edge => edge.sourceHandle === 'error');
        const actionTimeoutEdge = nodeEdges.find(edge => edge.sourceHandle === 'timeout');
        
        if (actionSuccessEdge) connections.success = actionSuccessEdge.target;
        if (actionErrorEdge) connections.error = actionErrorEdge.target;
        if (actionTimeoutEdge) connections.timeout = actionTimeoutEdge.target;
        break;

      case 'transfer':
        // Transfer nodes can have completed, failed, and timeout connections
        const completedEdge = nodeEdges.find(edge => edge.sourceHandle === 'completed' || !edge.sourceHandle);
        const failedEdge = nodeEdges.find(edge => edge.sourceHandle === 'failed');
        const transferTimeoutEdge = nodeEdges.find(edge => edge.sourceHandle === 'timeout');
        
        if (completedEdge) connections.completed = completedEdge.target;
        if (failedEdge) connections.failed = failedEdge.target;
        if (transferTimeoutEdge) connections.timeout = transferTimeoutEdge.target;
        break;

      case 'collect_info':
        // Collect info nodes need success and optional incomplete/error connections
        const collectSuccessEdge = nodeEdges.find(edge => edge.sourceHandle === 'success' || !edge.sourceHandle);
        const incompleteEdge = nodeEdges.find(edge => edge.sourceHandle === 'incomplete');
        const collectErrorEdge = nodeEdges.find(edge => edge.sourceHandle === 'error');
        
        if (collectSuccessEdge) connections.success = collectSuccessEdge.target;
        if (incompleteEdge) connections.incomplete = incompleteEdge.target;
        if (collectErrorEdge) connections.error = collectErrorEdge.target;
        break;

      case 'webhook':
        // Webhook nodes can have success and error connections
        const webhookSuccessEdge = nodeEdges.find(edge => edge.sourceHandle === 'success' || !edge.sourceHandle);
        const webhookErrorEdge = nodeEdges.find(edge => edge.sourceHandle === 'error');
        
        if (webhookSuccessEdge) connections.success = webhookSuccessEdge.target;
        if (webhookErrorEdge) connections.error = webhookErrorEdge.target;
        break;

      case 'end':
        // End nodes have no outgoing connections
        break;

      default:
        // Fallback for unknown node types - use generic 'next' connection
        const defaultNextEdge = nodeEdges.find(edge => !edge.sourceHandle);
        if (defaultNextEdge) {
          connections.next = defaultNextEdge.target;
        }
        break;
    }

    return connections;
  };

  const handleLoadFlow = (flowId: string) => {
    const flow = flowsData?.flows.find((f: FlowData) => f.id === flowId);
    if (!flow) return;

    const flowNodes = (flow.flow?.nodes || []) as any[];
    const reactNodes = flowNodes.map((node: any) => ({
      id: node.id,
      type: 'flowNode',
      position: node.position,
      data: {
        label: node.label,
        type: node.type,
        description: node.description,
        config: node.config
      }
    }));

    const reactEdges = flowNodes.flatMap((node: any) => 
      Object.entries(node.connections || {}).map(([handle, targetId]) => ({
        id: `${node.id}-${targetId}`,
        source: node.id,
        target: targetId as string,
        sourceHandle: handle === 'next' ? null : handle,
        markerEnd: { type: MarkerType.ArrowClosed }
      }))
    );

    setNodes(reactNodes);
    setEdges(reactEdges);
    setSelectedFlow(flowId);
    setSystemPrompt(flow.systemPrompt);
  };

  const currentFlow = flowsData?.flows.find((f: FlowData) => f.id === selectedFlow);
  const currentVersion = versionsData?.versions?.find((v: FlowVersion) => v.stage === 'draft') || versionsData?.versions?.[0];

  return (
    <div className="flex bg-background min-h-screen">
      <CustomerSidebar />
      
      <div className="ml-72 flex-1 flex">
        {/* Left Panel - Controls */}
        <div className="w-80 p-4 bg-muted/30 border-r space-y-4">
          {/* Flow Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-4 h-4" />
                Flow Builder
              </CardTitle>
              <CardDescription>Erstellen und bearbeiten Sie Ihre Voice Flows</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {flowsData?.flows && flowsData.flows.length > 0 && (
                <div>
                  <Label>Flow auswählen</Label>
                  <Select value={selectedFlow} onValueChange={handleLoadFlow} disabled={flowsLoading}>
                    <SelectTrigger data-testid="select-flow">
                      <SelectValue placeholder="Flow auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {flowsData.flows.map(flow => (
                        <SelectItem key={flow.id} value={flow.id} data-testid={`flow-option-${flow.id}`}>
                          {flow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <Button 
                className="w-full" 
                onClick={() => setIsCreateFlowOpen(true)}
                data-testid="button-create-flow"
              >
                <Plus className="w-4 h-4 mr-2" />
                Neuen Flow erstellen
              </Button>

              {selectedFlow && (
                <div className="space-y-2">
                  <Button 
                    className="w-full" 
                    onClick={handleSaveFlow}
                    disabled={updateFlowMutation.isPending}
                    data-testid="button-save-flow"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {updateFlowMutation.isPending ? 'Speichert...' : 'Flow speichern'}
                  </Button>

                  {currentVersion && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={currentVersion.stage === 'live' ? 'default' : 'secondary'}>
                          {currentVersion.stage.toUpperCase()}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          v{currentVersion.version}
                        </span>
                      </div>
                      
                      {currentVersion.stage === 'draft' && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="w-full"
                          onClick={() => promoteVersionMutation.mutate({ 
                            flowId: selectedFlow, 
                            versionId: currentVersion.id, 
                            targetStage: 'staged' 
                          })}
                          disabled={promoteVersionMutation.isPending}
                          data-testid="button-promote-staged"
                        >
                          <ArrowUpCircle className="w-4 h-4 mr-2" />
                          {promoteVersionMutation.isPending ? 'Promoting...' : 'Zu Staged'}
                        </Button>
                      )}
                      
                      {currentVersion.stage === 'staged' && (
                        <Button 
                          size="sm" 
                          className="w-full"
                          onClick={() => promoteVersionMutation.mutate({ 
                            flowId: selectedFlow, 
                            versionId: currentVersion.id, 
                            targetStage: 'live' 
                          })}
                          disabled={promoteVersionMutation.isPending}
                          data-testid="button-promote-live"
                        >
                          <ArrowUp className="w-4 h-4 mr-2" />
                          {promoteVersionMutation.isPending ? 'Promoting...' : 'Live schalten'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Node Palette */}
          <NodePalette />
          
          {/* Flow Info */}
          {currentFlow && (
            <Card>
              <CardHeader>
                <CardTitle>Flow Info</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div><strong>Name:</strong> {currentFlow.name}</div>
                  <div><strong>Status:</strong> <Badge variant="outline">{currentFlow.status}</Badge></div>
                  <div><strong>Knoten:</strong> {nodes.length}</div>
                  <div><strong>Verbindungen:</strong> {edges.length}</div>
                  <div><strong>Erstellt:</strong> {new Date(currentFlow.createdAt).toLocaleDateString()}</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Main Canvas */}
        <div className="flex-1 bg-gray-50">
          <div ref={reactFlowWrapper} className="w-full h-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypesMap}
              onInit={setReactFlowInstance}
              fitView
              data-testid="react-flow-canvas"
            >
              <Background />
              <Controls />
              <MiniMap />
            </ReactFlow>
          </div>
        </div>
      </div>

      {/* Create Flow Dialog */}
      <Dialog open={isCreateFlowOpen} onOpenChange={setIsCreateFlowOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuen Flow erstellen</DialogTitle>
            <DialogDescription>
              Erstellen Sie einen neuen Voice Flow für Ihre Kunden
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label>Flow Name</Label>
              <Input
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
                placeholder="Kundenservice Flow"
                data-testid="input-flow-name"
              />
            </div>
            
            <div>
              <Label>Beschreibung (optional)</Label>
              <Textarea
                value={flowDescription}
                onChange={(e) => setFlowDescription(e.target.value)}
                placeholder="Beschreibung des Flows..."
                data-testid="input-flow-description"
              />
            </div>
            
            <div>
              <Label>System Prompt</Label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Sie sind ein hilfsbereit Assistent..."
                rows={4}
                data-testid="input-system-prompt"
              />
            </div>
            
            <div className="flex gap-2 pt-4">
              <Button 
                onClick={handleCreateFlow}
                disabled={!flowName || createFlowMutation.isPending}
                data-testid="button-create-flow-confirm"
              >
                {createFlowMutation.isPending ? 'Erstellt...' : 'Flow erstellen'}
              </Button>
              <Button variant="outline" onClick={() => setIsCreateFlowOpen(false)}>
                Abbrechen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Node Editor Dialog */}
      <NodeEditor
        node={selectedNode}
        isOpen={isNodeEditOpen}
        onClose={() => setIsNodeEditOpen(false)}
        onSave={onNodeSave}
      />
    </div>
  );
}

// Main export wrapped with ReactFlowProvider
export default function FlowBuilder() {
  return (
    <ReactFlowProvider>
      <FlowBuilderContent />
    </ReactFlowProvider>
  );
}