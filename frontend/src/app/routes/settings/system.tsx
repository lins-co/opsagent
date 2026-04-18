import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  BellOff,
  Send,
  Trash2,
  Inbox,
} from 'lucide-react'

interface Settings {
  'wa.store_messages': boolean
  'wa.extract_patterns': boolean
  'wa.proactive_responses': boolean
  'wa.proactive_threshold': number
  'wa.extraction_interval_hours': number
  'wa.message_retention_days': number
  'pm.dms_enabled': boolean
  'pm.group_followups_enabled': boolean
  'pm.dm_digest_mode': boolean
  'pm.dm_digest_hour_ist': number
  'pm.dm_digest_min_items': number
}

interface MuteStatus {
  muted: boolean
  mutedUntil: string | null
  mutedReason: string | null
  mutedBy: string | null
  mutedAt: string | null
}

interface DmQueueUser {
  userId: string
  userName: string
  phone: string | null
  lastPmDigestAt: string | null
  items: { id: string; insightId: string | null; level: number; text: string; createdAt: string }[]
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
  const [muteStatus, setMuteStatus] = useState<MuteStatus | null>(null)
  const [dmQueue, setDmQueue] = useState<{ total: number; users: DmQueueUser[] }>({ total: 0, users: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [message, setMessage] = useState('')
  const [muteReason, setMuteReason] = useState('')
  const [showQueueDetails, setShowQueueDetails] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [s, st, g, ms, dq] = await Promise.all([
        api.get<{ settings: Settings }>('/settings'),
        api.get<MemoryStats>('/settings/memory-stats'),
        api.get<MonitoredGroup[]>('/settings/groups'),
        api.get<MuteStatus>('/settings/mute-status'),
        api.get<{ total: number; users: DmQueueUser[] }>('/settings/dm-queue'),
      ])
      setSettings(s.settings)
      setStats(st)
      setGroups(g)
      setMuteStatus(ms)
      setDmQueue(dq)
    } catch (err: any) {
      setMessage('Failed to load settings: ' + err.message)
    }
    setLoading(false)
  }

  const muteBot = async (duration: string) => {
    setSaving('mute')
    try {
      await api.post('/settings/mute', { duration, reason: muteReason || undefined })
      setMessage('Bot muted — all outbound notifications suppressed')
      setMuteReason('')
      await load()
    } catch (err: any) {
      setMessage('Failed: ' + err.message)
    }
    setSaving(null)
  }

  const unmuteBot = async () => {
    setSaving('unmute')
    try {
      await api.post('/settings/unmute', {})
      setMessage('Bot unmuted — notifications resumed')
      await load()
    } catch (err: any) {
      setMessage('Failed: ' + err.message)
    }
    setSaving(null)
  }

  const flushDigest = async () => {
    setSaving('flush')
    try {
      const res = await api.post<{ usersSent: number }>('/settings/dm-queue/flush', {})
      setMessage(`Digest sent to ${res.usersSent} user(s)`)
      await load()
    } catch (err: any) {
      setMessage('Failed: ' + err.message)
    }
    setSaving(null)
  }

  const removeQueueItem = async (id: string) => {
    try {
      await api.delete(`/settings/dm-queue/${id}`)
      await load()
    } catch (err: any) {
      setMessage('Failed: ' + err.message)
    }
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

        {/* ═══════════════════════════════════════════════ */}
        {/* MASTER MUTE — kill switch for all outbound msgs */}
        {/* ═══════════════════════════════════════════════ */}
        <Card className={`${muteStatus?.muted ? 'border-red-500/40 bg-red-500/5' : 'border-border bg-card'} transition-colors`}>
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${muteStatus?.muted ? 'bg-red-500/15' : 'bg-muted/50'}`}>
                <BellOff size={18} className={muteStatus?.muted ? 'text-red-400' : 'text-muted-foreground'} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  Notification Mute
                  {muteStatus?.muted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 font-medium uppercase tracking-wider">MUTED</span>
                  )}
                </h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  When muted, the bot sends NO outbound WhatsApp messages — no PM DMs, no group follow-ups, no proactive replies. Responds to user-initiated messages only.
                </p>
              </div>
            </div>

            {muteStatus?.muted ? (
              <>
                <Separator />
                <div className="space-y-2 text-[12px]">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20">Muted at:</span>
                    <span className="font-mono">{muteStatus.mutedAt ? new Date(muteStatus.mutedAt).toLocaleString() : '—'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20">Expires:</span>
                    <span className="font-mono">{muteStatus.mutedUntil ? new Date(muteStatus.mutedUntil).toLocaleString() : 'Indefinite — stays muted until manually unmuted'}</span>
                  </div>
                  {muteStatus.mutedReason && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20">Reason:</span>
                      <span>{muteStatus.mutedReason}</span>
                    </div>
                  )}
                </div>
                <Button onClick={unmuteBot} disabled={saving === 'unmute'} size="sm" className="gap-1.5 w-full">
                  {saving === 'unmute' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Unmute Now
                </Button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Optional reason (e.g. 'weekend, post office hours')"
                  value={muteReason}
                  onChange={(e) => setMuteReason(e.target.value)}
                  className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-[12px]"
                />
                <div className="grid grid-cols-4 gap-2">
                  <Button onClick={() => muteBot('1h')} disabled={saving === 'mute'} size="sm" variant="outline" className="text-[12px]">1 hour</Button>
                  <Button onClick={() => muteBot('4h')} disabled={saving === 'mute'} size="sm" variant="outline" className="text-[12px]">4 hours</Button>
                  <Button onClick={() => muteBot('24h')} disabled={saving === 'mute'} size="sm" variant="outline" className="text-[12px]">24 hours</Button>
                  <Button onClick={() => muteBot('indef')} disabled={saving === 'mute'} size="sm" variant="destructive" className="text-[12px] gap-1">
                    <BellOff size={12} /> Indef
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

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

        {/* Program Manager Notifications */}
        <Card className="bg-card border-border">
          <CardContent className="pt-5 space-y-4">
            <h3 className="text-sm font-semibold">Program Manager Notifications</h3>

            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-[13px] font-medium">Personal DMs to assignees</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">Check-ins, nudges, and escalation messages sent directly to the assigned person.</p>
              </div>
              <Switch
                checked={settings['pm.dms_enabled']}
                onCheckedChange={(v) => update('pm.dms_enabled', v)}
                disabled={saving === 'pm.dms_enabled'}
              />
            </div>

            <Separator />

            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-[13px] font-medium">Group follow-up posts</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">PM posts follow-ups in the WhatsApp group tagging the assignee for team visibility.</p>
              </div>
              <Switch
                checked={settings['pm.group_followups_enabled']}
                onCheckedChange={(v) => update('pm.group_followups_enabled', v)}
                disabled={saving === 'pm.group_followups_enabled'}
              />
            </div>
          </CardContent>
        </Card>

        {/* ═══════════════════════════════════════════════ */}
        {/* Daily DM Digest — once per user per day */}
        {/* ═══════════════════════════════════════════════ */}
        <Card className="bg-card border-border">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Inbox size={18} className="text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Daily DM Digest</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Batch all PM notifications into ONE message per user per day. Sent at the configured hour in IST. Prevents notification fatigue.
                </p>
              </div>
              <Switch
                checked={settings['pm.dm_digest_mode']}
                onCheckedChange={(v) => update('pm.dm_digest_mode', v)}
                disabled={saving === 'pm.dm_digest_mode'}
              />
            </div>

            {settings['pm.dm_digest_mode'] && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-muted-foreground">Send time (IST)</label>
                    <select
                      value={settings['pm.dm_digest_hour_ist']}
                      onChange={(e) => update('pm.dm_digest_hour_ist', Number(e.target.value))}
                      className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-[12px]"
                    >
                      {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-muted-foreground">Minimum items</label>
                    <select
                      value={settings['pm.dm_digest_min_items']}
                      onChange={(e) => update('pm.dm_digest_min_items', Number(e.target.value))}
                      className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-[12px]"
                    >
                      <option value={1}>1 (send even for single issue)</option>
                      <option value={2}>2+ items</option>
                      <option value={3}>3+ items</option>
                    </select>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-[13px] font-semibold">Pending queue</h4>
                    <p className="text-[11px] text-muted-foreground">
                      {dmQueue.total} message{dmQueue.total === 1 ? '' : 's'} waiting across {dmQueue.users.length} user{dmQueue.users.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => setShowQueueDetails(!showQueueDetails)} size="sm" variant="outline" className="text-[11px]" disabled={dmQueue.total === 0}>
                      {showQueueDetails ? 'Hide' : 'Show'}
                    </Button>
                    <Button onClick={flushDigest} disabled={saving === 'flush' || dmQueue.total === 0} size="sm" variant="outline" className="text-[11px] gap-1">
                      {saving === 'flush' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Flush Now
                    </Button>
                  </div>
                </div>

                {showQueueDetails && dmQueue.users.length > 0 && (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {dmQueue.users.map((u) => (
                      <div key={u.userId} className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-[13px] font-medium">{u.userName}</p>
                            <p className="text-[11px] text-muted-foreground">
                              +{u.phone || '—'} · {u.items.length} item{u.items.length === 1 ? '' : 's'}
                              {u.lastPmDigestAt && ` · last digest: ${new Date(u.lastPmDigestAt).toLocaleString()}`}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {u.items.map((item) => (
                            <div key={item.id} className="flex items-start gap-2 text-[11px] p-2 rounded bg-background/50 border border-border/50">
                              <span className="text-muted-foreground font-mono w-6 flex-shrink-0">L{item.level}</span>
                              <span className="flex-1 min-w-0 truncate">{item.text}</span>
                              <button onClick={() => removeQueueItem(item.id)} className="text-muted-foreground hover:text-destructive">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
