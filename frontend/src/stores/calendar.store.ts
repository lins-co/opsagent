import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CalendarEvent {
  id: string
  summary: string
  start: string // ISO datetime or date
  end: string
  location?: string
  htmlLink?: string
  colorId?: string
  status?: string
}

interface CalendarState {
  accessToken: string | null
  events: CalendarEvent[]
  setAccessToken: (token: string) => void
  setEvents: (events: CalendarEvent[]) => void
  disconnect: () => void
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set) => ({
      accessToken: null,
      events: [],
      setAccessToken: (accessToken) => set({ accessToken }),
      setEvents: (events) => set({ events }),
      disconnect: () => set({ accessToken: null, events: [] }),
    }),
    { name: 'emo-calendar' }
  )
)
