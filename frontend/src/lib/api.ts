import { useAuthStore } from '../stores/auth.store'

// In dev: uses Vite proxy to /api → localhost:3000
// In prod: uses VITE_API_URL env var (e.g. https://api.your-domain.com)
const API_HOST = import.meta.env.VITE_API_URL || ''
const BASE_URL = `${API_HOST}/api`

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }

  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// SSE chat — streams status updates then returns final message
export interface ChatSSECallbacks {
  onStatus: (status: string, node: string) => void
  onConversationId: (id: string) => void
  onDone: (data: { conversationId: string; message: any }) => void
  onError: (error: string) => void
}

export function chatSSE(
  message: string,
  conversationId: string | null,
  callbacks: ChatSSECallbacks,
): AbortController {
  const controller = new AbortController()
  const token = useAuthStore.getState().token

  fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, conversationId, stream: true }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        callbacks.onError(body.error || 'Request failed')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { callbacks.onError('No stream'); return }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue

          try {
            const event = JSON.parse(jsonStr)
            switch (event.type) {
              case 'status':
                callbacks.onStatus(event.status, event.node)
                break
              case 'conversation':
                callbacks.onConversationId(event.conversationId)
                break
              case 'done':
                callbacks.onDone(event)
                break
              case 'error':
                callbacks.onError(event.error)
                break
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError(err.message || 'Connection failed')
      }
    })

  return controller
}
