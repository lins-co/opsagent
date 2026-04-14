import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Brain,
  MessageSquare,
  Database,
  Zap,
  Clock,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  FileImage,
} from 'lucide-react'

interface Settings {
  'wa.store_messages': boolean
  'wa.extract_patterns': boolean
  'wa.proactive_responses': boolean
  'wa.proactive_threshold': number
  'wa.extraction_interval_hours': number
  'wa.message_retention_days': number
}

interface MemoryStats {
  msgCount: number
  insightCount: number
  mediaCount: number
  openIssues: number
}

interface MonitoredGroup {
  id: string
  chatId: string
  chatName: string
  messageCount: number
  lastMessageAt: string | null
  proactiveEnabled: boolean
}

export default function SystemSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [groups, setGroups] = useState<MonitoredGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [s, st, g] = await Promise.all([
        api.get<{ settings: Settings }>('/settings'),
        api.get<MemoryStats>('/settings/memory-stats'),
        api.get<MonitoredGroup[]>('/settings/groups'),
      ])
      setSettings(s.settings)
      setStats(st)
      setGroups(g)
    } catch (err: any) {
      setMessage('Failed to load settings: ' + err.message)
    }
    setLoading(false)
  }

  const toggleGroupProactive = async (groupId: string, enabled: boolean) => {
    setSaving(`group-${groupId}`)
    try {
      await api.patch(`/settings/groups/${groupId}`, { proactiveEnabled: enabled })
      setGroups(groups.map(g => g.id === groupId ? { ...g, proactiveEnabled: enabled } : g))
    } catch (err: any) {
      setMessage('Failed: ' + err.message)
    }
    setSaving(null)
  }

  const update = async (key: keyof Settings, value: any) => {
    if (!settings) return
    setSaving(key)
    try {
      await api.patch(`/settings/${key}`, { value })
      setSettings({ ...settings, [key]: value })
      setMessage(`Updated ${key}`)
      setTimeout(() => setMessage(''), 2000)
    } catch (err: any) {
      setMessage('Failed: ' + err.message)
    }
    setSaving(null)
  }

  const triggerExtraction = async () => {
    setTriggering(true)
    try {
      const res = await api.post<{ extracted: number }>('/settings/insights/trigger', { hours: 24 })
      setMessage(`Extracted ${res.extracted} insights`)
      await load()
    } catch (err: any) {
      setMessage('Failed: ' + err.message)
    }
    setTriggering(false)
  }

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
  if (!settings) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">System Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">WhatsApp memory, pattern extraction, and proactive responses</p>
        </div>

        {message && (
          <div className="px-3 py-2 rounded-lg bg-primary/10 text-primary text-[12px] border border-primary/20">
            {message}
          </div>
        )}

        {/* Memory Stats */}
        {stats && (
          <Card className="bg-card border-border">
            <CardContent className="pt-5">
              <h3 className="text-sm font-semibold mb-3">Memory Stats</h3>
              <div className="grid grid-cols-4 gap-3">
                <StatBox icon={<MessageSquare size={14} />} label="Messages" value={stats.msgCount} />
                <StatBox icon={<Brain size={14} />} label="Insights" value={stats.insightCount} />
                <StatBox icon={<FileImage size={14} />} label="Media Files" value={stats.mediaCount} />
                <StatBox icon={<AlertTriangle size={14} />} label="Open Issues" value={stats.openIssues} accent />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Message Storage */}
        <Card className="bg-card border-border">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Database size={16} className="text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Persistent Message Storage</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">Save every monitored group message to PostgreSQL. Required for history search and pattern detection.</p>
              </div>
              <Switch
                checked={settings['wa.store_messages']}
                onCheckedChange={(v) => update('wa.store_messages', v)}
                disabled={saving === 'wa.store_messages'}
              />
            </div>
          </CardContent>
        </Card>

        {/* Pattern Extraction */}
        <Card className="bg-card border-border">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <Brain size={16} className="text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Pattern Extraction</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">AI analyzes stored messages every few hours to find recurring issues and complaints.</p>
              </div>
              <Switch
                checked={settings['wa.extract_patterns']}
                onCheckedChange={(v) => update('wa.extract_patterns', v)}
                disabled={saving === 'wa.extract_patterns'}
              />
            </div>

            <Separator />

            <div className="flex items-center gap-3">
              <Clock size={14} className="text-muted-foreground" />
              <span className="text-[13px] text-muted-foreground flex-1">Run extraction every</span>
              <select
                value={settings['wa.extraction_interval_hours']}
                onChange={(e) => update('wa.extraction_interval_hours', Number(e.target.value))}
                disabled={saving === 'wa.extraction_interval_hours'}
                className="bg-secondary border border-border rounded px-2 py-1 text-[12px]"
              >
                <option value={1}>1 hour</option>
                <option value={2}>2 hours</option>
                <option value={4}>4 hours</option>
                <option value={6}>6 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>24 hours</option>
              </select>
            </div>

            <Button onClick={triggerExtraction} disabled={triggering} size="sm" variant="outline" className="gap-1.5">
              {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Run Extraction Now
            </Button>
          </CardContent>
        </Card>

        {/* Proactive Responses */}
        <Card className="bg-card border-border">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <Zap size={16} className="text-emerald-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Proactive Bot Responses</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  When a recurring issue is reported again in a group, the bot auto-responds with escalation context.
                </p>
              </div>
              <Switch
                checked={settings['wa.proactive_responses']}
                onCheckedChange={(v) => update('wa.proactive_responses', v)}
                disabled={saving === 'wa.proactive_responses'}
              />
            </div>

            {settings['wa.proactive_responses'] && (
              <>
                <Separator />
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={14} className="text-muted-foreground" />
                  <span className="text-[13px] text-muted-foreground flex-1">Trigger after</span>
                  <select
                    value={settings['wa.proactive_threshold']}
                    onChange={(e) => update('wa.proactive_threshold', Number(e.target.value))}
                    className="bg-secondary border border-border rounded px-2 py-1 text-[12px]"
                  >
                    <option value={2}>2nd occurrence</option>
                    <option value={3}>3rd occurrence</option>
                    <option value={5}>5th occurrence</option>
                  </select>
                </div>
                <p className="text-[11px] text-muted-foreground italic">Bot replies in group once per hour max per group.</p>

                <Separator />

                <div>
                  <h4 className="text-[12px] font-semibold mb-2 uppercase tracking-wider text-muted-foreground">Enable in specific groups</h4>
                  <div className="space-y-1.5">
                    {groups.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground italic">No monitored groups yet.</p>
                    ) : (
                      groups.map((g) => (
                        <div key={g.id} className="flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-secondary/40">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium truncate">{g.chatName}</p>
                            <p className="text-[11px] text-muted-foreground">{g.messageCount} msgs</p>
                          </div>
                          <Switch
                            checked={g.proactiveEnabled}
                            onCheckedChange={(v) => toggleGroupProactive(g.id, v)}
                            disabled={saving === `group-${g.id}`}
                          />
                        </div>
                      ))
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground italic mt-2">
                    Only enable in groups where bot auto-replies are welcome. All groups are OFF by default.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-5 space-y-3">
            <h3 className="text-sm font-semibold">Retention</h3>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-muted-foreground flex-1">Keep messages for</span>
              <select
                value={settings['wa.message_retention_days']}
                onChange={(e) => update('wa.message_retention_days', Number(e.target.value))}
                className="bg-secondary border border-border rounded px-2 py-1 text-[12px]"
              >
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>6 months</option>
                <option value={365}>1 year</option>
              </select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatBox({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent && value > 0 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-secondary/30 border-border'}`}>
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <div className={`text-lg font-semibold tabular-nums ${accent && value > 0 ? 'text-amber-400' : ''}`}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}
