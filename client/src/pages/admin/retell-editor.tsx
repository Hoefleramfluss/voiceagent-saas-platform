import { useEffect, useState } from 'react';
import AdminSidebar from '@/components/admin-sidebar';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function RetellEditor() {
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [agentJson, setAgentJson] = useState<string>('');

  useEffect(() => {
    apiRequest('GET', '/api/retell/agents')
      .then((res) => res.json())
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);
  useEffect(() => {
    if (agentId) {
      apiRequest('GET', `/api/retell/agent/${agentId}`)
        .then((res) => res.json())
        .then((data) => setAgentJson(JSON.stringify(data, null, 2)));
    }
  }, [agentId]);

  const save = async () => {
    const body = JSON.parse(agentJson || '{}');
    await apiRequest('PATCH', `/api/retell/agents/${agentId}`, body);
    alert('Agent aktualisiert');
  };

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="ml-72 p-8 max-w-5xl w-full">
        <h1 className="text-2xl font-semibold mb-4">Retell Agent Editor</h1>
        <div className="space-y-2 mb-4">
          <Label>Agent wählen</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger><SelectValue placeholder="Agent auswählen" /></SelectTrigger>
            <SelectContent>
              {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Agent JSON (Tools, Kalender, Trigger, etc.)</Label>
          <Textarea rows={24} value={agentJson} onChange={e=> setAgentJson(e.target.value)} />
        </div>
        <div className="mt-4"><Button onClick={save} disabled={!agentId}>Speichern</Button></div>
      </div>
    </div>
  );
}
