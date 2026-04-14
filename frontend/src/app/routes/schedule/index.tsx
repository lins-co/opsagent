import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  CalendarClock,
  Plus,
  Play,
  Trash2,
  Mail,
  Paperclip,
  Clock,
  Loader2,
  Check,
  X,
  Pencil,
} from 'lucide-react'

interface Schedule {
  id: string
  name: string
  prompt: string
  scheduleCron: string
  deliveryChannel: string
  deliveryTarget: string
  isActive: boolean
  dataScope: { attachCsv?: boolean }
  lastRunAt: string | null
  createdAt: string
}

const DAYS = [
  { label: 'Every day', value: '*' },
  { label: 'Mon', value: '1' },
  { label: 'Tue', value: '2' },
  { label: 'Wed', value: '3' },
  { label: 'Thu', value: '4' },
  { label: 'Fri', value: '5' },
  { label: 'Sat', value: '6' },
  { label: 'Sun', value: '0' },
  { label: 'Weekdays', value: '1-5' },
  { label: '1st of month', value: 'monthly' },
]

function buildCron(day: string, hour: number, minute: number): string {
  if (day === 'monthly') return `${minute} ${hour} 1 * *`;
  return `${minute} ${hour} * * ${day}`;
}

function parseCron(cron: string): { day: string; hour: number; minute: number } {
  const parts = cron.split(' ');
  if (parts.length !== 5) return { day: '*', hour: 9, minute: 0 };
  const minute = parseInt(parts[0]) || 0;
  const hour = parseInt(parts[1]) || 9;
  if (parts[2] === '1' && parts[4] === '*') return { day: 'monthly', hour, minute };
  return { day: parts[4], hour, minute };
}

function formatSchedule(cron: string): string {
  const { day, hour, minute } = parseCron(cron);
  const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayLabel = day === '*' ? 'Every day' : day === '1-5' ? 'Weekdays' : day === 'monthly' ? '1st of month' : DAYS.find(d => d.value === day)?.label || day;
  return `${dayLabel} at ${time}`;
}

const PROMPT_TEMPLATES = [
  { label: 'Fleet Health Summary', prompt: 'Generate a comprehensive fleet health report covering vehicle status breakdown by location, maintenance needs, and deployment readiness.' },
  { label: 'Battery Risk Report', prompt: 'Analyze all battery complaints, identify top issues by severity, highlight critical patterns, and list vehicles needing immediate attention.' },
  { label: 'Complaint Analysis', prompt: 'Summarize all complaints this period — top categories, resolution rates, location hotspots, and recurring vehicle issues.' },
  { label: 'Operational Overview', prompt: 'Generate a full operational overview: fleet status, complaints, battery health, rentals, and key risk indicators across all locations.' },
]

export default function SchedulePage() {
  const user = useAuthStore((s) => s.user)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  // Create form state
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [cronValue, setCronValue] = useState('0 9 * * 1')
  const [schedDay, setSchedDay] = useState('1')
  const [schedHour, setSchedHour] = useState(9)
  const [schedMinute, setSchedMinute] = useState(0)
  const [deliveryTarget, setDeliveryTarget] = useState(user?.email || '')
  const [attachCsv, setAttachCsv] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    loadSchedules()
  }, [])

  const loadSchedules = async () => {
    try {
      const data = await api.get<Schedule[]>('/reports/scheduled')
      setSchedules(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!name || !prompt) return
    setCreating(true)
    const finalCron = buildCron(schedDay, schedHour, schedMinute)
    try {
      await api.post('/reports/schedule', {
        name,
        prompt,
        scheduleCron: finalCron,
        deliveryChannel: 'email',
        deliveryTarget: deliveryTarget || user?.email,
        attachCsv,
      })
      setShowCreate(false)
      resetForm()
      await loadSchedules()
    } catch (err: any) {
      alert(err.message || 'Failed to create schedule')
    } finally {
      setCreating(false)
    }
  }

  const resetForm = () => {
    setName('')
    setPrompt('')
    setCronValue('0 9 * * 1')
    setSchedDay('1')
    setSchedHour(9)
    setSchedMinute(0)
    setDeliveryTarget(user?.email || '')
    setAttachCsv(false)
  }

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await api.patch(`/reports/scheduled/${id}`, { isActive: !isActive })
      setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: !isActive } : s)))
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this scheduled report?')) return
    try {
      await api.delete(`/reports/scheduled/${id}`)
      setSchedules((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const handleRunNow = async (id: string) => {
    setRunningId(id)
    try {
      await api.post(`/reports/scheduled/${id}/run`, {})
      await loadSchedules()
    } catch (err: any) {
      alert(err.message || 'Failed to run report')
    } finally {
      setRunningId(null)
    }
  }

  // formatCron uses the top-level formatSchedule

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Scheduled Reports</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Automated AI reports delivered to your inbox on a schedule.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            New Schedule
          </Button>
        </div>

        {/* ─── Create Form ─── */}
        {showCreate && (
          <Card className="bg-card border-border mb-6">
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Create Scheduled Report</h3>
                <button onClick={() => { setShowCreate(false); resetForm() }} className="p-1 rounded hover:bg-secondary text-muted-foreground">
                  <X size={16} />
                </button>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Report Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Weekly Fleet Summary" />
              </div>

              {/* Prompt Templates */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Quick Templates</label>
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => { setPrompt(t.prompt); if (!name) setName(t.label) }}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-[11px] border transition-colors',
                        prompt === t.prompt
                          ? 'bg-accent-soft border-primary/30 text-primary'
                          : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Prompt */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">AI Prompt</label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what you want the AI to analyze and report on..."
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Schedule — Day Picker */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Repeat On</label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setSchedDay(d.value)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-[12px] border transition-colors',
                        schedDay === d.value
                          ? 'bg-accent-soft border-primary/30 text-primary font-medium'
                          : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule — Time Picker */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Time</label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-1">
                    <select
                      value={schedHour}
                      onChange={(e) => setSchedHour(parseInt(e.target.value))}
                      className="bg-transparent text-[13px] text-foreground py-2 px-2 focus:outline-none appearance-none cursor-pointer"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i} className="bg-card">
                          {i.toString().padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                    <span className="text-muted-foreground text-[13px]">:</span>
                    <select
                      value={schedMinute}
                      onChange={(e) => setSchedMinute(parseInt(e.target.value))}
                      className="bg-transparent text-[13px] text-foreground py-2 px-2 focus:outline-none appearance-none cursor-pointer"
                    >
                      {[0, 15, 30, 45].map((m) => (
                        <option key={m} value={m} className="bg-card">
                          {m.toString().padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-[12px] text-muted-foreground">
                    {formatSchedule(buildCron(schedDay, schedHour, schedMinute))}
                  </span>
                </div>
              </div>

              {/* Delivery */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Deliver To</label>
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-muted-foreground flex-shrink-0" />
                  <Input
                    value={deliveryTarget}
                    onChange={(e) => setDeliveryTarget(e.target.value)}
                    placeholder="email@emoenergy.in"
                    type="email"
                  />
                </div>
              </div>

              {/* Attach CSV toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Paperclip size={16} className="text-muted-foreground" />
                  <div>
                    <p className="text-[13px] font-medium">Attach CSV Data</p>
                    <p className="text-[11px] text-muted-foreground">AI will attach relevant data as a CSV file to the email</p>
                  </div>
                </div>
                <button
                  onClick={() => setAttachCsv(!attachCsv)}
                  className={cn(
                    'w-10 h-6 rounded-full transition-colors relative',
                    attachCsv ? 'bg-primary' : 'bg-border'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform',
                      attachCsv ? 'translate-x-4.5' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button onClick={handleCreate} disabled={!name || !prompt || creating} className="gap-1.5">
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Create Schedule
                </Button>
                <Button variant="outline" onClick={() => { setShowCreate(false); resetForm() }}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Schedule List ─── */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : schedules.length === 0 && !showCreate ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-xl bg-accent-soft flex items-center justify-center mb-4">
                <CalendarClock size={24} className="text-primary" />
              </div>
              <h3 className="text-sm font-medium mb-1">No scheduled reports yet</h3>
              <p className="text-[13px] text-muted-foreground max-w-sm mb-4">
                Create a schedule to have AI-generated reports automatically sent to your inbox.
              </p>
              <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
                <Plus size={14} /> Create your first schedule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {schedules.map((s) => (
              <Card key={s.id} className={cn('bg-card border-border transition-opacity', !s.isActive && 'opacity-50')}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CalendarClock size={16} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium truncate">{s.name}</h3>
                        <Badge variant="outline" className={cn('text-[10px]', s.isActive ? 'text-emerald-400 border-emerald-400/30' : 'text-muted-foreground')}>
                          {s.isActive ? 'Active' : 'Paused'}
                        </Badge>
                        {(s.dataScope as any)?.attachCsv && (
                          <Badge variant="outline" className="text-[10px] text-primary border-primary/30 gap-1">
                            <Paperclip size={9} /> CSV
                          </Badge>
                        )}
                      </div>
                      <p className="text-[12px] text-muted-foreground line-clamp-2 mb-2">{s.prompt}</p>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {formatSchedule(s.scheduleCron)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Mail size={11} /> {s.deliveryTarget}
                        </span>
                        {s.lastRunAt && (
                          <span>Last run: {new Date(s.lastRunAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => handleRunNow(s.id)}
                        disabled={runningId === s.id}
                        title="Run now"
                      >
                        {runningId === s.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => handleToggle(s.id, s.isActive)}
                        title={s.isActive ? 'Pause' : 'Activate'}
                      >
                        {s.isActive ? <X size={14} /> : <Check size={14} />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(s.id)}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
