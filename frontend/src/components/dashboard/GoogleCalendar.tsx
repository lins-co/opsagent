import { useEffect, useState, useCallback, useMemo } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore, type CalendarEvent } from '@/stores/calendar.store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  ExternalLink,
  LogOut,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── API ──

async function fetchCalendarEvents(
  accessToken: string,
  year: number,
  month: number
): Promise<CalendarEvent[]> {
  // Fetch events for the entire month + overflow days visible on the grid
  const timeMin = new Date(year, month, 1).toISOString()
  const timeMax = new Date(year, month + 1, 7).toISOString()

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: '250',
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 401) throw new Error('TOKEN_EXPIRED')
  if (!res.ok) throw new Error('Failed to fetch calendar events')

  const data = await res.json()

  return (data.items || [])
    .filter((item: any) => item.status !== 'cancelled')
    .map((item: any) => ({
      id: item.id,
      summary: item.summary || '(No title)',
      start: item.start?.dateTime || item.start?.date || '',
      end: item.end?.dateTime || item.end?.date || '',
      location: item.location,
      htmlLink: item.htmlLink,
      colorId: item.colorId,
      status: item.status,
    }))
}

// ── Helpers ──

function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const startOffset = firstDay.getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells: { date: number; month: number; year: number; isCurrentMonth: boolean }[] = []

  // Previous month overflow
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({
      date: daysInPrevMonth - i,
      month: month - 1,
      year: month === 0 ? year - 1 : year,
      isCurrentMonth: false,
    })
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: d, month, year, isCurrentMonth: true })
  }

  // Next month overflow to fill 6 rows
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    cells.push({
      date: d,
      month: month + 1,
      year: month === 11 ? year + 1 : year,
      isCurrentMonth: false,
    })
  }

  return cells
}

function dateKey(year: number, month: number, date: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
}

function eventDateKey(isoString: string): string {
  const d = new Date(isoString)
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatTime(isoString: string): string {
  if (!isoString.includes('T')) return 'All day'
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const EVENT_DOT_COLORS: Record<string, string> = {
  '1': 'bg-blue-400',
  '2': 'bg-green-400',
  '3': 'bg-purple-400',
  '4': 'bg-pink-400',
  '5': 'bg-yellow-400',
  '6': 'bg-orange-400',
  '7': 'bg-cyan-400',
  '8': 'bg-gray-400',
  '9': 'bg-indigo-400',
  '10': 'bg-emerald-400',
  '11': 'bg-red-400',
}

const EVENT_BAR_COLORS: Record<string, string> = {
  '1': 'bg-blue-500/20',
  '2': 'bg-green-500/20',
  '3': 'bg-purple-500/20',
  '4': 'bg-pink-500/20',
  '5': 'bg-yellow-500/20',
  '6': 'bg-orange-500/20',
  '7': 'bg-cyan-500/20',
  '8': 'bg-gray-500/20',
  '9': 'bg-indigo-500/20',
  '10': 'bg-emerald-500/20',
  '11': 'bg-red-500/20',
}

// ── Component ──

export default function GoogleCalendar() {
  const { accessToken, events, setAccessToken, setEvents, disconnect } = useCalendarStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string>(
    dateKey(today.getFullYear(), today.getMonth(), today.getDate())
  )

  const login = useGoogleLogin({
    scope: CALENDAR_SCOPE,
    onSuccess: (tokenResponse) => {
      setAccessToken(tokenResponse.access_token)
      setError('')
    },
    onError: () => setError('Failed to connect Google Calendar'),
  })

  const loadEvents = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const fetched = await fetchCalendarEvents(accessToken, viewYear, viewMonth)
      setEvents(fetched)
    } catch (err: any) {
      if (err.message === 'TOKEN_EXPIRED') {
        disconnect()
        setError('Session expired. Please reconnect.')
      } else {
        setError('Failed to load events')
      }
    } finally {
      setLoading(false)
    }
  }, [accessToken, viewYear, viewMonth, setEvents, disconnect])

  useEffect(() => {
    if (accessToken) loadEvents()
  }, [accessToken, loadEvents])

  // Build events-by-date lookup
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = eventDateKey(event.start)
      const arr = map.get(key) || []
      arr.push(event)
      map.set(key, arr)
    }
    return map
  }, [events])

  const grid = useMemo(() => getMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  const selectedEvents = eventsByDate.get(selectedDate) || []

  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate())
  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const goToToday = () => {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    setSelectedDate(todayKey)
  }

  // ── Not connected ──
  if (!accessToken) {
    return (
      <Card className="bg-card border-border h-full">
        <CardContent className="pt-16 pb-16">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
              <CalendarIcon size={28} className="text-primary" />
            </div>
            <div>
              <p className="text-base font-medium">Google Calendar</p>
              <p className="text-[13px] text-muted-foreground mt-1">
                Connect your calendar to see events right on your dashboard
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button variant="outline" className="gap-2 mt-2" onClick={() => login()}>
              <GoogleCalendarIcon />
              Connect Google Calendar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Connected ──
  return (
    <Card className="bg-card border-border">
      {/* Header */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CalendarIcon size={16} className="text-primary" />
            Calendar
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={loadEvents}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={disconnect} title="Disconnect">
              <LogOut size={13} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 pb-4">
        {error && <p className="text-xs text-destructive mb-3">{error}</p>}

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3">
          <Button variant="ghost" size="icon-xs" onClick={goToPrevMonth}>
            <ChevronLeft size={16} />
          </Button>
          <button
            onClick={goToToday}
            className="text-sm font-semibold hover:text-primary transition-colors"
          >
            {monthLabel}
          </button>
          <Button variant="ghost" size="icon-xs" onClick={goToNextMonth}>
            <ChevronRight size={16} />
          </Button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS_OF_WEEK.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-1"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {grid.map((cell, i) => {
            const key = dateKey(cell.year, cell.month, cell.date)
            const isToday = key === todayKey
            const isSelected = key === selectedDate
            const dayEvents = eventsByDate.get(key) || []
            const hasEvents = dayEvents.length > 0

            return (
              <button
                key={i}
                onClick={() => setSelectedDate(key)}
                className={cn(
                  'relative flex flex-col items-center py-1.5 rounded-lg transition-colors',
                  !cell.isCurrentMonth && 'opacity-30',
                  isSelected
                    ? 'bg-primary/15'
                    : 'hover:bg-muted/40',
                )}
              >
                <span
                  className={cn(
                    'w-7 h-7 flex items-center justify-center rounded-full text-[13px]',
                    isToday && !isSelected && 'bg-primary text-primary-foreground font-bold',
                    isToday && isSelected && 'bg-primary text-primary-foreground font-bold',
                  )}
                >
                  {cell.date}
                </span>
                {/* Event dots */}
                <div className="flex gap-0.5 mt-0.5 h-[5px]">
                  {hasEvents &&
                    dayEvents.slice(0, 3).map((ev, j) => (
                      <span
                        key={j}
                        className={cn(
                          'w-[5px] h-[5px] rounded-full',
                          EVENT_DOT_COLORS[ev.colorId || ''] || 'bg-primary'
                        )}
                      />
                    ))}
                </div>
              </button>
            )
          })}
        </div>

        {/* Selected day events */}
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {(() => {
              const parts = selectedDate.split('-')
              const d = new Date(+parts[0], +parts[1], +parts[2])
              if (d.toDateString() === today.toDateString()) return 'Today'
              return d.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })
            })()}
          </p>

          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={16} className="animate-spin text-muted-foreground" />
            </div>
          ) : selectedEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No events</p>
          ) : (
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
              {selectedEvents.map((event) => (
                <a
                  key={event.id}
                  href={event.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'group flex items-start gap-2.5 p-2.5 rounded-lg transition-colors',
                    EVENT_BAR_COLORS[event.colorId || ''] || 'bg-primary/10',
                    'hover:ring-1 hover:ring-primary/30'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate group-hover:text-primary transition-colors">
                      {event.summary}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock size={10} />
                        {formatTime(event.start)}
                        {event.end && ` – ${formatTime(event.end)}`}
                      </span>
                      {event.location && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                          <MapPin size={10} />
                          <span className="truncate max-w-[140px]">{event.location}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <ExternalLink
                    size={12}
                    className="text-muted-foreground/0 group-hover:text-muted-foreground transition-colors mt-1 flex-shrink-0"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function GoogleCalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M18 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 2v4M8 2v4M4 10h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="14" r="1" fill="#4285F4" />
      <circle cx="12" cy="14" r="1" fill="#34A853" />
      <circle cx="16" cy="14" r="1" fill="#EA4335" />
      <circle cx="8" cy="17.5" r="1" fill="#FBBC05" />
      <circle cx="12" cy="17.5" r="1" fill="#4285F4" />
    </svg>
  )
}
