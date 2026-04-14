import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chat.store'
import { api, chatSSE } from '@/lib/api'
import { cn } from '@/lib/utils'
import MarkdownMessage from '@/components/chat/MarkdownMessage'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Send,
  Plus,
  Paperclip,
  Search,
  Trash2,
  MessageSquare,
  Bot,
  User,
  Sparkles,
  BarChart3,
  Battery,
  AlertTriangle,
  Wrench,
  FileText,
} from 'lucide-react'

const QUICK_ACTIONS = [
  { label: 'Fleet health overview', icon: BarChart3, query: 'Give me an overview of fleet health across all locations' },
  { label: 'Battery risk summary', icon: Battery, query: 'Show me the battery risk summary — any critical packs?' },
  { label: 'Recent complaints', icon: AlertTriangle, query: 'What are the most recent complaints and their status?' },
  { label: 'Service log summary', icon: Wrench, query: 'Summarize recent service logs and top root causes' },
]

const AGENT_BADGES: Record<string, { label: string; color: string }> = {
  fleet: { label: 'Fleet Agent', color: 'bg-blue-500/15 text-blue-500 dark:text-blue-400 border-blue-500/20' },
  battery: { label: 'Battery Agent', color: 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/20' },
  complaint: { label: 'Complaint Agent', color: 'bg-amber-500/15 text-amber-500 dark:text-amber-400 border-amber-500/20' },
  service: { label: 'Service Agent', color: 'bg-purple-500/15 text-purple-500 dark:text-purple-400 border-purple-500/20' },
  report: { label: 'Report Agent', color: 'bg-pink-500/15 text-pink-500 dark:text-pink-400 border-pink-500/20' },
  general: { label: 'General Agent', color: 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400 border-zinc-500/20' },
}

export default function Chat() {
  const [input, setInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const {
    conversations,
    activeConversationId,
    messages,
    isStreaming,
    setConversations,
    setActiveConversation,
    setMessages,
    addMessage,
    setStreaming,
  } = useChatStore()

  useEffect(() => {
    api.get<any[]>('/conversations').then(setConversations).catch(console.error)
  }, [])

  useEffect(() => {
    if (activeConversationId) {
      api.get<any[]>(`/conversations/${activeConversationId}/messages`).then(setMessages).catch(console.error)
    } else {
      setMessages([])
    }
  }, [activeConversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || isStreaming) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'

    addMessage({ id: crypto.randomUUID(), role: 'user', content: msg, createdAt: new Date().toISOString() })
    setStreaming(true)
    setStreamStatus('Sending...')

    chatSSE(msg, activeConversationId, {
      onStatus: (status) => setStreamStatus(status),
      onConversationId: (id) => {
        if (!activeConversationId) {
          setActiveConversation(id)
          api.get<any[]>('/conversations').then(setConversations).catch(console.error)
        }
      },
      onDone: (data) => {
        addMessage({
          id: data.message.id,
          role: 'assistant',
          content: data.message.content,
          createdAt: data.message.createdAt,
          source: data.message.agentName || data.message.source,
        })
        setStreaming(false)
        setStreamStatus(null)
      },
      onError: (error) => {
        addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Something went wrong: ${error}`,
          createdAt: new Date().toISOString(),
        })
        setStreaming(false)
        setStreamStatus(null)
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const startNewChat = () => { setActiveConversation(null); setMessages([]); inputRef.current?.focus() }

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.delete(`/conversations/${id}`)
      setConversations(conversations.filter((c) => c.id !== id))
      if (activeConversationId === id) { setActiveConversation(null); setMessages([]) }
    } catch { /* ignore */ }
  }

  const filtered = conversations.filter((c) =>
    !searchQuery || (c.title || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-full bg-background no-scrollbar">
      {/* ─── Conversation Sidebar ─── */}
      <div className="w-72 flex-shrink-0 border-r border-border/40 flex flex-col bg-sidebar/30 backdrop-blur-md z-10 hidden md:flex">
        <div className="px-5 py-5 space-y-4">
          <Button variant="outline" className="w-full justify-start gap-3 bg-card/50 border-border/60 hover:bg-card/80 subtle-hover h-10 rounded-xl" onClick={startNewChat}>
            <Plus size={16} className="text-primary" /> 
            <span className="font-semibold text-[13px]">New Workspace</span>
          </Button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-input/40 border border-border/50 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 px-3">
          <div className="space-y-1 pb-4">
            <p className="px-3 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2">Past Conversations</p>
            {filtered.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setActiveConversation(conv.id)}
                className={cn(
                  'group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-300',
                  activeConversationId === conv.id
                    ? 'bg-primary/10 text-primary font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                )}
              >
                <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors", activeConversationId === conv.id ? "bg-primary text-white scale-105" : "bg-secondary text-muted-foreground group-hover:text-foreground")}>
                  <MessageSquare size={12} />
                </div>
                <span className="truncate flex-1 text-left leading-relaxed">{conv.title || 'New Session'}</span>
                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                >
                  <Trash2 size={13} />
                </button>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-10 px-4">
                <div className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-3">
                   <MessageSquare size={16} className="text-muted-foreground/50" />
                </div>
                <p className="text-[12px] text-muted-foreground">
                  {searchQuery ? 'No history found' : 'Your history is clean'}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ─── Chat Area ─── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/50 relative">
        
        {/* Ambient Glows */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center gap-3 px-6 h-14 border-b border-border/40 glass-panel border-x-0 border-t-0 flex-shrink-0 sticky top-0 z-20">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 border border-primary/20">
             <Sparkles size={14} className="text-primary" />
          </div>
          <h1 className="text-[14px] font-semibold truncate text-foreground flex-1">
            {activeConversationId
              ? conversations.find((c) => c.id === activeConversationId)?.title || 'Intelligence Chat'
              : 'New Analysis Workspace'}
          </h1>
          {isStreaming && streamStatus && (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-card border border-border/60 rounded-full text-[11px] font-semibold text-primary shadow-sm glass-panel">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {streamStatus}
            </span>
          )}
        </div>

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth">
          <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 relative z-10">
            {/* Empty state */}
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto animate-in fade-in zoom-in duration-500">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/20 to-accent/5 border border-primary/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(var(--primary),0.15)]">
                  <Bot className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2 text-foreground text-center">Hello, how can I assist you?</h2>
                <p className="text-[15px] text-muted-foreground mb-10 text-center leading-relaxed">
                  I'm your EMO Intelligence multi-agent system. Ask complicated queries, run fleet diagnostics, or attach telemetry data for deep analysis.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => handleSend(a.query)}
                      className="group flex flex-col items-start gap-2 p-4 rounded-2xl border border-border/40 glass-panel hover:-translate-y-0.5 hover:border-primary/30 subtle-hover text-left transition-all"
                    >
                      <div className="w-8 h-8 rounded-lg bg-secondary/80 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                        <a.icon size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <span className="text-[13px] font-medium text-muted-foreground group-hover:text-foreground transition-colors leading-snug">
                        {a.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className={cn('flex gap-4 animate-in slide-in-from-bottom-2 fade-in duration-300', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-accent/5 border border-primary/20 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div className={cn('max-w-[85%] space-y-1 flex flex-col', msg.role === 'user' ? 'items-end' : 'items-start')}>
                    {msg.role === 'assistant' && msg.source && AGENT_BADGES[msg.source] && (
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border', AGENT_BADGES[msg.source].color, 'mb-1 shadow-sm')}>
                        {AGENT_BADGES[msg.source].label}
                      </span>
                    )}
                    <div
                      className={cn(
                        'px-5 py-4 shadow-sm text-[14px] leading-relaxed',
                        msg.role === 'user'
                          ? 'bg-gradient-to-br from-primary to-accent text-white rounded-[24px] rounded-br-[8px] shadow-[0_4px_16px_oklch(0_0_0/0.08)]'
                          : 'bg-card/80 backdrop-blur-md border border-border/60 rounded-[24px] rounded-bl-[8px] shadow-[0_4px_16px_oklch(0_0_0/0.03)]'
                      )}
                    >
                      {msg.role === 'assistant' ? (
                         <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
                           <MarkdownMessage content={msg.content} />
                         </div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      )}
                    </div>
                    <p className="text-[10px] font-medium text-muted-foreground px-2 pt-1">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-secondary border border-border/60 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <User className="w-4 h-4 text-foreground/70" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {isStreaming && (
              <div className="flex gap-4 mt-6 animate-in fade-in duration-300">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-accent/5 border border-primary/20 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-card/80 backdrop-blur-md border border-border/60 rounded-[24px] rounded-bl-[8px] px-5 py-4 shadow-sm min-w-[120px]">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                    </div>
                    {streamStatus && (
                      <span className="text-[12px] font-medium text-muted-foreground">{streamStatus}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Input Region */}
        <div className="p-4 md:px-8 md:pb-6 flex-shrink-0 z-20">
          <div className="max-w-4xl mx-auto">
            <div className="relative flex items-end gap-2 rounded-[24px] border border-border/50 bg-card/80 backdrop-blur-xl p-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.15)] focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all duration-300">
              <button className="p-2.5 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 flex items-center justify-center" title="Attach Telemetry CSV">
                <Paperclip size={18} />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the intelligence layer..."
                rows={1}
                className="flex-1 resize-none bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[24px] max-h-[200px] py-2.5 no-scrollbar leading-relaxed"
                style={{ height: 'auto', overflow: 'hidden' }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement
                  t.style.height = 'auto'
                  t.style.height = Math.min(t.scrollHeight, 200) + 'px'
                  if (t.scrollHeight > 200) { t.style.overflowY = 'auto' } else { t.style.overflowY = 'hidden' }
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isStreaming}
                className={cn(
                  'h-10 w-10 flex items-center justify-center rounded-xl flex-shrink-0 transition-all duration-300',
                  input.trim() && !isStreaming
                    ? 'bg-primary text-white shadow-md shadow-primary/30 hover:bg-primary/90 hover:scale-105'
                    : 'bg-secondary text-muted-foreground/50 cursor-not-allowed'
                )}
              >
                <Send size={16} className={cn(input.trim() && !isStreaming && "translate-x-0.5 -translate-y-0.5")} />
              </button>
            </div>
            <p className="text-[11px] font-medium text-muted-foreground/70 text-center mt-3 flex items-center justify-center gap-1.5">
               <Sparkles size={11} className="text-primary/70" />
               AI agents can make mistakes. Verify critical telemetry data.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
