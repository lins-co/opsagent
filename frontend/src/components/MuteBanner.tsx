import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { BellOff, Clock } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'

interface MuteStatus {
  muted: boolean
  mutedUntil: string | null
  mutedReason: string | null
}

// Persistent top-of-app banner shown whenever the bot is muted.
// Polls every 30s so admins/teammates always see the current mute state.
export default function MuteBanner() {
  const [status, setStatus] = useState<MuteStatus | null>(null)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const fetchStatus = async () => {
      try {
        const s = await api.get<MuteStatus>('/settings/mute-status')
        if (!cancelled) setStatus(s)
      } catch {
        // Silent — banner just won't show
      }
    }

    fetchStatus()
    const iv = setInterval(fetchStatus, 30_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [user])

  if (!status?.muted) return null

  return (
    <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 flex items-center justify-center gap-2 text-[12px] text-red-400">
      <BellOff size={14} className="flex-shrink-0" />
      <span className="font-medium">Bot notifications MUTED</span>
      <span className="text-red-400/70">—</span>
      {status.mutedUntil ? (
        <span className="flex items-center gap-1">
          <Clock size={12} />
          <span>until {new Date(status.mutedUntil).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      ) : (
        <span>indefinitely</span>
      )}
      {status.mutedReason && (
        <>
          <span className="text-red-400/70">·</span>
          <span className="truncate max-w-xs">{status.mutedReason}</span>
        </>
      )}
    </div>
  )
}
