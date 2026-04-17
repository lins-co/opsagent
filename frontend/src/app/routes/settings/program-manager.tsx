import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  UserCog,
  Target,
  Zap,
  RefreshCw,
} from 'lucide-react'

// ─────────────── Types ───────────────

interface TeamMember {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  org: string
  specialties: string[]
  waGroupIds: string[]
  reportsToId: string | null
  isAvailable: boolean
  outOfOfficeUntil: string | null
  workingHoursStart: number
  workingHoursEnd: number
  openAssignedCount: number
}

interface Insight {
  id: string
  type: string
  title: string
  summary: string
  severity: string
  category: string | null
  status: string
  groupName: string | null
  vehicleIds: string[]
  location: string | null
  reporterNames: string[]
  firstSeen: string
  lastSeen: string
  occurrenceCount: number
  reminderCount: number
  escalationLevel: number
  isStuck: boolean
  assignedUser: { name: string; phone?: string } | null
  deferredUntil: string | null
  followupAt: string | null
}

const ALL_SPECIALTIES = ['battery', 'charger', 'vehicle', 'payment', 'app', 'infrastructure', 'escalation']
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/20',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
}

export default function ProgramManagerPanel() {
  const [tab, setTab] = useState<'roster' | 'insights'>('insights')
  const [team, setTeam] = useState<TeamMember[]>([])
  const [insights, setInsights] = useState<{ open: Insight[]; stuck: Insight[]; recentResolved: Insight[] }>({ open: [], stuck: [], recentResolved: [] })
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [t, i] = await Promise.all([
        api.get<TeamMember[]>('/team'),
        api.get<typeof insights>('/team/insights'),
      ])
      setTeam(t)
      setInsights(i)
    } catch {}
    setLoading(false)
  }

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Target size={20} className="text-primary" /> Program Manager
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Assign specialties, manage escalation, track open issues</p>
          </div>
          <Button onClick={load} variant="outline" size="sm" className="gap-1.5">
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="Open Issues" value={insights.open.length} icon={<AlertTriangle size={16} className="text-amber-400" />} />
          <StatCard label="Stuck" value={insights.stuck.length} icon={<Zap size={16} className="text-red-400" />} />
          <StatCard label="Recently Resolved" value={insights.recentResolved.length} icon={<CheckCircle2 size={16} className="text-emerald-400" />} />
          <StatCard label="Team Members" value={team.length} icon={<Users size={16} className="text-blue-400" />} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-secondary/50 rounded-lg p-1 w-fit">
          <TabBtn active={tab === 'insights'} onClick={() => setTab('insights')}>Issues ({insights.open.length + insights.stuck.length})</TabBtn>
          <TabBtn active={tab === 'roster'} onClick={() => setTab('roster')}>Team Roster ({team.length})</TabBtn>
        </div>

        {tab === 'insights' && <InsightsPanel insights={insights} team={team} onRefresh={load} />}
        {tab === 'roster' && <RosterPanel team={team} editingId={editingId} setEditingId={setEditingId} onRefresh={load} />}
      </div>
    </div>
  )
}

// ─────────────── Insights Panel ───────────────

function InsightsPanel({ insights, team, onRefresh }: { insights: { open: Insight[]; stuck: Insight[]; recentResolved: Insight[] }; team: TeamMember[]; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      {insights.stuck.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-red-400 flex items-center gap-1.5"><Zap size={14} /> Stuck ({insights.stuck.length})</h3>
          {insights.stuck.map((i) => <InsightRow key={i.id} insight={i} team={team} onRefresh={onRefresh} />)}
          <Separator />
        </>
      )}

      <h3 className="text-sm font-semibold flex items-center gap-1.5"><AlertTriangle size={14} /> Open ({insights.open.length})</h3>
      {insights.open.length === 0 && <p className="text-sm text-muted-foreground">No open issues. Nice.</p>}
      {insights.open.map((i) => <InsightRow key={i.id} insight={i} team={team} onRefresh={onRefresh} />)}

      {insights.recentResolved.length > 0 && (
        <>
          <Separator />
          <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={14} /> Recently Resolved ({insights.recentResolved.length})</h3>
          {insights.recentResolved.slice(0, 10).map((i) => <InsightRow key={i.id} insight={i} team={team} onRefresh={onRefresh} resolved />)}
        </>
      )}
    </div>
  )
}

function InsightRow({ insight: i, team, onRefresh, resolved }: { insight: Insight; team: TeamMember[]; onRefresh: () => void; resolved?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const age = Math.round((Date.now() - new Date(i.firstSeen).getTime()) / 3_600_000)

  const handleReassign = async (userId: string) => {
    setReassigning(true)
    try {
      await api.patch(`/team/insights/${i.id}/assign`, { userId })
      onRefresh()
    } catch {}
    setReassigning(false)
  }

  return (
    <Card className={`bg-card border-border ${i.isStuck ? 'border-red-500/30' : ''}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={SEVERITY_COLORS[i.severity] || ''}>{i.severity}</Badge>
              {i.category && <Badge variant="outline" className="text-[10px]">{i.category}</Badge>}
              {i.isStuck && <Badge variant="outline" className="text-red-400 border-red-400/30 text-[10px]">STUCK</Badge>}
              <span className="text-[11px] text-muted-foreground">{i.id.slice(0, 8)}</span>
            </div>
            <p className="text-sm font-medium mt-1 truncate">{i.title}</p>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              <span>{age}h old</span>
              {i.groupName && <span>{i.groupName}</span>}
              {i.location && <span>{i.location}</span>}
              {i.assignedUser ? (
                <span className="text-primary">{i.assignedUser.name}</span>
              ) : (
                <span className="text-amber-400">unassigned</span>
              )}
              {i.reminderCount > 0 && <span>pinged {i.reminderCount}x</span>}
              {i.escalationLevel > 0 && <span className="text-red-400">esc.L{i.escalationLevel}</span>}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="shrink-0">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border space-y-3">
            <p className="text-[13px] text-muted-foreground">{i.summary}</p>

            {i.vehicleIds.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {i.vehicleIds.map((v) => <Badge key={v} variant="outline" className="text-[10px] font-mono">{v}</Badge>)}
              </div>
            )}

            <div className="text-[11px] text-muted-foreground space-y-0.5">
              {i.reporterNames.length > 0 && <p>Reported by: {i.reporterNames.join(', ')}</p>}
              {i.followupAt && <p>Next follow-up: {new Date(i.followupAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}
              {i.deferredUntil && <p>Deferred until: {new Date(i.deferredUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}
              <p>Seen {i.occurrenceCount}x since {new Date(i.firstSeen).toLocaleDateString('en-IN')}</p>
            </div>

            {!resolved && (
              <div className="flex items-center gap-2 pt-1">
                <select
                  className="h-8 rounded-md border border-border bg-background px-2 text-[12px] flex-1 max-w-[200px]"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) handleReassign(e.target.value) }}
                  disabled={reassigning}
                >
                  <option value="" disabled>{reassigning ? 'Assigning...' : 'Reassign to...'}</option>
                  {team.filter((t) => t.phone).map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.role}) — {t.openAssignedCount} open</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────── Roster Panel ───────────────

function RosterPanel({ team, editingId, setEditingId, onRefresh }: { team: TeamMember[]; editingId: string | null; setEditingId: (id: string | null) => void; onRefresh: () => void }) {
  return (
    <div className="space-y-3">
      {team.map((m) => (
        <MemberRow key={m.id} member={m} isEditing={editingId === m.id} onEdit={() => setEditingId(editingId === m.id ? null : m.id)} team={team} onRefresh={onRefresh} />
      ))}
    </div>
  )
}

function MemberRow({ member: m, isEditing, onEdit, team, onRefresh }: { member: TeamMember; isEditing: boolean; onEdit: () => void; team: TeamMember[]; onRefresh: () => void }) {
  const [specs, setSpecs] = useState<string[]>(m.specialties)
  const [reportsTo, setReportsTo] = useState(m.reportsToId || '')
  const [startH, setStartH] = useState(m.workingHoursStart)
  const [endH, setEndH] = useState(m.workingHoursEnd)
  const [available, setAvailable] = useState(m.isAvailable)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/team/${m.id}`, {
        specialties: specs,
        reportsToId: reportsTo || null,
        workingHoursStart: startH,
        workingHoursEnd: endH,
        isAvailable: available,
      })
      onRefresh()
      onEdit()
    } catch {}
    setSaving(false)
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center text-sm font-semibold text-primary">
              {m.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.name}</span>
                <Badge variant="outline" className="text-[10px]">{m.role}</Badge>
                {!m.phone && <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">no phone</Badge>}
                {!m.isAvailable && <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">OOO</Badge>}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                <span>{m.email}</span>
                <span>{m.openAssignedCount} open</span>
                {m.specialties.length > 0 && <span>{m.specialties.join(', ')}</span>}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1">
            <UserCog size={14} /> {isEditing ? 'Close' : 'Edit'}
          </Button>
        </div>

        {isEditing && (
          <div className="mt-4 pt-3 border-t border-border space-y-4">
            {/* Specialties */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">Specialties</label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_SPECIALTIES.map((s) => (
                  <button
                    key={s}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                      specs.includes(s)
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-background border-border text-muted-foreground hover:border-primary/30'
                    }`}
                    onClick={() => setSpecs(specs.includes(s) ? specs.filter((x) => x !== s) : [...specs, s])}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Reports To */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">Reports To</label>
              <select
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-[13px]"
                value={reportsTo}
                onChange={(e) => setReportsTo(e.target.value)}
              >
                <option value="">None (top-level)</option>
                {team.filter((t) => t.id !== m.id).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
                ))}
              </select>
            </div>

            {/* Working Hours */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">Start hour (IST)</label>
                <Input type="number" min={0} max={23} value={startH} onChange={(e) => setStartH(Number(e.target.value))} className="h-9 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">End hour (IST)</label>
                <Input type="number" min={1} max={24} value={endH} onChange={(e) => setEndH(Number(e.target.value))} className="h-9 text-[13px]" />
              </div>
            </div>

            {/* Availability */}
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-medium text-muted-foreground">Available for assignments</label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{available ? 'Yes' : 'OOO'}</span>
                <button
                  className={`w-10 h-5 rounded-full transition-colors ${available ? 'bg-emerald-500' : 'bg-muted'}`}
                  onClick={() => setAvailable(!available)}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${available ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            <Button onClick={save} disabled={saving} size="sm" className="gap-1.5 w-full">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────── Shared ───────────────

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
        {icon}
        <div>
          <p className="text-lg font-semibold">{value}</p>
          <p className="text-[11px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
