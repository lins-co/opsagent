import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Phone,
  Mail,
  Shield,
  MapPin,
  MessageCircle,
  Check,
  Loader2,
  Unlink,
  Sparkles,
} from 'lucide-react'

interface UserProfile {
  id: string
  email: string
  name: string
  phone: string | null
  role: string
  permissions: Record<string, boolean>
  orgNode: { id: string; name: string; level: number }
  allowedLocations: string[]
}

interface BotPrefs {
  enabled: boolean
  tone: 'formal' | 'casual' | 'balanced' | 'concise'
  responseLength: 'short' | 'medium' | 'detailed'
  language: 'en' | 'hi' | 'hinglish'
  emojiUsage: 'none' | 'minimal' | 'expressive'
  customInstructions: string | null
}

const DEFAULT_PREFS: BotPrefs = {
  enabled: true,
  tone: 'balanced',
  responseLength: 'medium',
  language: 'en',
  emojiUsage: 'minimal',
  customInstructions: '',
}

export default function ProfileSettings() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [phoneInput, setPhoneInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  // Bot preferences state
  const [prefs, setPrefs] = useState<BotPrefs>(DEFAULT_PREFS)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsMsg, setPrefsMsg] = useState('')

  useEffect(() => { loadProfile(); loadPrefs() }, [])

  const loadProfile = async () => {
    try {
      const data = await api.get<UserProfile>('/auth/me')
      setProfile(data)
      setPhoneInput(data.phone || '')
    } catch {}
    setLoading(false)
  }

  const loadPrefs = async () => {
    try {
      const data = await api.get<BotPrefs>('/me/bot-preferences')
      setPrefs({ ...DEFAULT_PREFS, ...data, customInstructions: data.customInstructions ?? '' })
    } catch {}
  }

  const savePrefs = async () => {
    setPrefsSaving(true)
    setPrefsMsg('')
    try {
      const payload = { ...prefs, customInstructions: prefs.customInstructions?.trim() || null }
      await api.put('/me/bot-preferences', payload)
      setPrefsMsg('Saved')
      setTimeout(() => setPrefsMsg(''), 2000)
    } catch (err: any) {
      setPrefsMsg(err.message || 'Failed to save')
    }
    setPrefsSaving(false)
  }

  const handleLinkPhone = async () => {
    if (!phoneInput.trim()) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.patch<{ ok: boolean; phone: string; message: string }>('/auth/phone', { phone: phoneInput })
      setSuccess(res.message)
      await loadProfile()
    } catch (err: any) {
      setError(err.message || 'Failed to link phone')
    }
    setSaving(false)
  }

  const handleUnlinkPhone = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await api.delete('/auth/phone')
      setPhoneInput('')
      setSuccess('Phone unlinked')
      await loadProfile()
    } catch (err: any) {
      setError(err.message || 'Failed')
    }
    setSaving(false)
  }

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
  if (!profile) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight mb-6">Profile & Settings</h1>

        {/* Profile Info */}
        <Card className="bg-card border-border mb-4">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-accent-soft flex items-center justify-center text-xl font-semibold text-primary">
                {profile.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-base font-semibold">{profile.name}</h2>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4 text-[13px]">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Shield size={14} />
                <span>Role: <strong className="text-foreground capitalize">{profile.role}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin size={14} />
                <span>Org: <strong className="text-foreground">{profile.orgNode.name}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail size={14} />
                <span className="truncate">{profile.email}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone size={14} />
                <span>{profile.phone ? `+${profile.phone}` : 'Not linked'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Phone Linking */}
        <Card className="bg-card border-border mb-4">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <MessageCircle size={20} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">WhatsApp Bot Access</h3>
                <p className="text-[12px] text-muted-foreground">Link your phone to chat with EMO AI directly on WhatsApp</p>
              </div>
              {profile.phone && (
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30 ml-auto gap-1">
                  <Check size={10} /> Linked
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={phoneInput}
                  onChange={(e) => { setPhoneInput(e.target.value); setSuccess(''); setError(''); }}
                  placeholder="919876543210 (with country code, no +)"
                  className="pl-10 font-mono"
                />
              </div>
              <Button onClick={handleLinkPhone} disabled={saving || !phoneInput.trim()} size="sm" className="gap-1.5">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {profile.phone ? 'Update' : 'Link'}
              </Button>
              {profile.phone && (
                <Button onClick={handleUnlinkPhone} disabled={saving} variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                  <Unlink size={14} /> Unlink
                </Button>
              )}
            </div>

            {success && <p className="text-[12px] text-emerald-400">{success}</p>}
            {error && <p className="text-[12px] text-destructive">{error}</p>}

            <div className="rounded-lg bg-secondary/50 border border-border p-3 text-[12px] text-muted-foreground space-y-1">
              <p><strong className="text-foreground">How it works:</strong></p>
              <p>1. Enter your WhatsApp number (with country code, e.g. 919876543210)</p>
              <p>2. Send any message to the connected EMO WhatsApp number</p>
              <p>3. The AI bot will recognize you and respond with your permissions</p>
              <p>4. Your WhatsApp conversations are saved and visible in the web dashboard</p>
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Bot Personality */}
        <Card className="bg-card border-border mb-4">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Sparkles size={20} className="text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Bot Reply Style (WhatsApp DM)</h3>
                <p className="text-[12px] text-muted-foreground">Configure how the EMO bot responds to you in personal chat</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{prefs.enabled ? 'On' : 'Off'}</span>
                <Switch
                  checked={prefs.enabled}
                  onCheckedChange={(v: boolean) => setPrefs({ ...prefs, enabled: v })}
                />
              </div>
            </div>

            <div className={prefs.enabled ? '' : 'opacity-50 pointer-events-none'}>
              <div className="grid grid-cols-2 gap-3">
                <PrefSelect
                  label="Tone"
                  value={prefs.tone}
                  onChange={(v) => setPrefs({ ...prefs, tone: v as BotPrefs['tone'] })}
                  options={[
                    { value: 'balanced', label: 'Balanced' },
                    { value: 'formal', label: 'Formal' },
                    { value: 'casual', label: 'Casual' },
                    { value: 'concise', label: 'Concise' },
                  ]}
                />
                <PrefSelect
                  label="Length"
                  value={prefs.responseLength}
                  onChange={(v) => setPrefs({ ...prefs, responseLength: v as BotPrefs['responseLength'] })}
                  options={[
                    { value: 'short', label: 'Short' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'detailed', label: 'Detailed' },
                  ]}
                />
                <PrefSelect
                  label="Language"
                  value={prefs.language}
                  onChange={(v) => setPrefs({ ...prefs, language: v as BotPrefs['language'] })}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'hi', label: 'हिन्दी' },
                    { value: 'hinglish', label: 'Hinglish' },
                  ]}
                />
                <PrefSelect
                  label="Emoji"
                  value={prefs.emojiUsage}
                  onChange={(v) => setPrefs({ ...prefs, emojiUsage: v as BotPrefs['emojiUsage'] })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'minimal', label: 'Minimal' },
                    { value: 'expressive', label: 'Expressive' },
                  ]}
                />
              </div>

              <div className="mt-4 space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">Custom instructions (optional)</label>
                <Textarea
                  value={prefs.customInstructions || ''}
                  onChange={(e) => setPrefs({ ...prefs, customInstructions: e.target.value.slice(0, 1000) })}
                  placeholder="e.g. Always start with the headline number. Skip greetings. Address me as 'Boss'."
                  rows={3}
                  className="text-[13px]"
                />
                <p className="text-[11px] text-muted-foreground">{(prefs.customInstructions || '').length}/1000 — style only; cannot override data scope or security rules.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              {prefsMsg && <span className="text-[12px] text-emerald-400">{prefsMsg}</span>}
              <Button onClick={savePrefs} disabled={prefsSaving} size="sm" className="gap-1.5">
                {prefsSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Save preferences
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Admin: System Settings Link */}
        {profile.role === 'admin' && (
          <Card className="bg-card border-border mb-4">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Shield size={16} className="text-purple-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold">System Settings</h3>
                  <p className="text-[12px] text-muted-foreground">Configure WhatsApp memory, pattern extraction, proactive responses</p>
                </div>
                <Button onClick={() => window.location.href = '/settings/system'} size="sm" variant="outline">Open</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Permissions */}
        <Card className="bg-card border-border">
          <CardContent className="pt-5">
            <h3 className="text-sm font-semibold mb-3">Permissions</h3>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(profile.permissions as Record<string, boolean>).map(([key, value]) => (
                <Badge
                  key={key}
                  variant="outline"
                  className={value ? 'text-emerald-400 border-emerald-400/30' : 'text-muted-foreground border-border'}
                >
                  {value ? '✓' : '✗'} {key.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function PrefSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-md border border-border bg-background px-2 text-[13px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
