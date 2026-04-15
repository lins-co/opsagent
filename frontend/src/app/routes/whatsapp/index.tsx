import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import {
  WifiOff,Users,User,Eye,EyeOff,Loader2,Search,
  MoreVertical,Paperclip,Smile,Send,Radio,ArrowDown
} from 'lucide-react'

interface WAStatus { connected: boolean; number: string | null; qrPending: boolean; monitoredGroups: number }
interface WAChat { id: string; name: string; isGroup: boolean; participantCount?: number; isMonitored: boolean }
interface MonitoredGroup { id: string; chatId: string; chatName: string; isActive: boolean; messageCount: number; lastMessageAt: string | null }

function formatTime(ts: number | string): string {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' })
}

const SENDER_COLORS = [
  '#53bdeb', '#51b854', '#fc952c', '#e65e8a', '#c24ecc', '#00bfa5', '#e91e63'
]
const senderColorMap = new Map<string, string>()
function getSenderColor(name: string): string {
  if (!senderColorMap.has(name)) {
    senderColorMap.set(name, SENDER_COLORS[senderColorMap.size % SENDER_COLORS.length])
  }
  return senderColorMap.get(name)!
}

export default function WhatsAppPage() {
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<WAStatus>({ connected: false, number: null, qrPending: false, monitoredGroups: 0 })
  const [chats, setChats] = useState<WAChat[]>([])
  const [monitored, setMonitored] = useState<MonitoredGroup[]>([])
  const [selectedChat, setSelectedChat] = useState<WAChat | null>(null)
  const [chatMessages, setChatMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<'chats' | 'monitored'>('chats')
  const [showMenu, setShowMenu] = useState(false)
  
  // Sending logic
  const [messageInput, setMessageInput] = useState('')
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadStatus() }, [])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  const loadStatus = async () => {
    try {
      const s = await api.get<WAStatus>('/whatsapp/status')
      setStatus(s)
      if (s.connected) await Promise.all([loadChats(), loadMonitored()])
    } catch {}
    setLoading(false)
  }

  const loadChats = async () => { try { setChats(await api.get<WAChat[]>('/whatsapp/chats')) } catch {} }
  const loadMonitored = async () => { try { setMonitored(await api.get<MonitoredGroup[]>('/whatsapp/monitored')) } catch {} }

  const toggleMonitor = async (chat: WAChat) => {
    try {
      if (chat.isMonitored) await api.delete(`/whatsapp/monitor/${encodeURIComponent(chat.id)}`)
      else await api.post('/whatsapp/monitor', { chatId: chat.id, chatName: chat.name, isGroup: chat.isGroup })
      await Promise.all([loadChats(), loadMonitored()])
      if (selectedChat?.id === chat.id) {
        setSelectedChat(prev => prev ? { ...prev, isMonitored: !chat.isMonitored } : null)
      }
    } catch (err: any) { alert(err.message || 'Failed') }
    setShowMenu(false)
  }

  const selectChat = async (chat: WAChat | MonitoredGroup) => {
    const isMonGrp = 'chatId' in chat
    const actualChatId = isMonGrp ? chat.chatId : chat.id
    const actualName = isMonGrp ? chat.chatName : chat.name
    const isMonitored = isMonGrp ? true : (chat as WAChat).isMonitored
    
    setSelectedChat({ id: actualChatId, name: actualName, isGroup: true, isMonitored })
    setLoadingMessages(true)
    setChatMessages([])
    setShowMenu(false)
    try {
      const msgs = await api.get<any[]>(`/whatsapp/chats/${encodeURIComponent(actualChatId)}/messages?limit=100`)
      setChatMessages(msgs)
    } catch { setChatMessages([]) }
    setLoadingMessages(false)
  }

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedChat) return
    setSending(true)
    const text = messageInput.trim()
    setMessageInput('')
    
    // Add optimistically assuming fromMe = true
    const fakeId = `temp-${Date.now()}`
    setChatMessages(prev => [...prev, {
      id: fakeId,
      body: text,
      timestamp: Date.now() / 1000,
      fromMe: true,
      senderName: user?.name || 'You',
      fromName: user?.name || 'You'
    }])
    
    try {
      await api.post('/whatsapp/send', { chatId: selectedChat.id, message: text })
      // Fetch live update silently after 1 sec to get actual WhatsApp state
      setTimeout(async () => {
         const msgs = await api.get<any[]>(`/whatsapp/chats/${encodeURIComponent(selectedChat.id)}/messages?limit=100`)
         setChatMessages(msgs)
      }, 1500)
    } catch (err: any) {
      alert("Failed to send message: " + err.message)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() }
  }

  const filteredChats = chats.filter((c) => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()))

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>

  if (!status.connected) {
    return (
      <div className="h-full bg-[#f0f2f5] dark:bg-[#111b21] flex items-center justify-center">
        <div className="bg-white dark:bg-[#202c33] p-10 rounded-lg shadow-sm border border-border mx-auto max-w-md text-center">
          <WifiOff size={48} className="mx-auto mb-6 text-muted-foreground" />
          <h1 className="text-xl font-normal mb-3 text-foreground">Phone not connected</h1>
          <p className="text-[14px] text-muted-foreground mb-8">
            Check your backend terminal for the WhatsApp QR code.
          </p>
          <button onClick={loadStatus} className="px-6 py-2 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-full font-medium transition-colors">
            Refresh Connection
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-row bg-[#f0f2f5] dark:bg-[#111b21] text-[#111b21] dark:text-[#e9edef] overflow-hidden w-full">
      
      {/* ─── Left Sidebar (Chat List) ─── */}
      <div className="w-[320px] min-w-[320px] md:w-[400px] md:min-w-[400px] lg:w-[420px] lg:min-w-[420px] flex-shrink-0 flex flex-col border-r border-[#d1d7db] dark:border-[#222d34] bg-white dark:bg-[#111b21] h-full">
        
        {/* Sidebar Header */}
        <div className="h-[59px] bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between px-4 sticky top-0 flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-[#dfe5e7] dark:bg-[#53616a] overflow-hidden flex items-center justify-center text-[#54656f] dark:text-[#aebac1]">
            <User size={24} />
          </div>
          <div className="flex items-center gap-3 text-[#54656f] dark:text-[#aebac1]">
            <button onClick={() => setTab(tab === 'chats' ? 'monitored' : 'chats')} title={tab === 'chats' ? 'View Monitored Groups' : 'View All Chats'} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors relative">
              <Radio size={20} />
              {tab === 'monitored' && <span className="absolute bottom-1 right-1 w-2.5 h-2.5 bg-[#00a884] border-2 border-white dark:border-[#202c33] rounded-full"></span>}
            </button>
            <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
              <MoreVertical size={20} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="h-[49px] bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#202c33] px-3 flex items-center flex-shrink-0">
          <div className="flex bg-[#f0f2f5] dark:bg-[#202c33] w-full rounded-lg px-3 items-center h-9 transition-all">
            {searchQuery ? (
              <button onClick={() => setSearchQuery('')} className="p-1 -ml-1 text-[#00a884]">
                <ArrowDown size={18} className="rotate-90" />
              </button>
            ) : (
              <Search size={16} className="text-[#54656f] dark:text-[#8696a0]" />
            )}
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or start new chat"
              className="bg-transparent border-none outline-none w-full ml-4 text-[14px] placeholder:text-[#54656f] dark:placeholder:text-[#8696a0]"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {tab === 'chats' ? (
            filteredChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => selectChat(chat)}
                className={cn(
                  'w-full flex items-center px-3 h-[72px] hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors',
                  selectedChat?.id === chat.id && 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                )}
              >
                <div className="w-[49px] h-[49px] rounded-full bg-[#dfe5e7] dark:bg-[#53616a] flex items-center justify-center flex-shrink-0 text-[#54656f] dark:text-[#aebac1]">
                  {chat.isGroup ? <Users size={24} /> : <User size={24} />}
                </div>
                <div className="ml-4 flex-1 border-b border-[#f0f2f5] dark:border-[#222d34] h-full flex flex-col justify-center min-w-0 pr-3">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-[17px] truncate text-left text-[#111b21] dark:text-[#e9edef] leading-tight">{chat.name}</span>
                    <span className="text-[12px] text-[#00a884] min-w-[50px] text-right"></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] text-[#54656f] dark:text-[#8696a0] truncate text-left flex-1" title={chat.id}>
                      {chat.isGroup ? 'Group Chat' : 'Direct Message'}
                    </span>
                    {chat.isMonitored && (
                      <span className="w-2 h-2 rounded-full bg-[#00a884] flex-shrink-0" />
                    )}
                  </div>
                </div>
              </button>
            ))
          ) : (
            monitored.map((m) => (
              <button
                key={m.id}
                onClick={() => selectChat(m)}
                className={cn(
                  'w-full flex items-center px-3 h-[72px] hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors',
                  selectedChat?.id === m.chatId && 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                )}
              >
                <div className="w-[49px] h-[49px] rounded-full bg-[#dfe5e7] dark:bg-[#53616a] flex items-center justify-center flex-shrink-0 text-[#54656f] dark:text-[#aebac1] relative">
                  <Users size={24} />
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-[#00a884] border-2 border-white dark:border-[#111b21] rounded-full flex items-center justify-center"><Radio size={8} className="text-white" /></span>
                </div>
                <div className="ml-4 flex-1 border-b border-[#f0f2f5] dark:border-[#222d34] h-full flex flex-col justify-center min-w-0 pr-3">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-[17px] truncate text-left text-[#111b21] dark:text-[#e9edef] leading-tight">{m.chatName}</span>
                    <span className="text-[12px] text-[#54656f] dark:text-[#8696a0] min-w-[50px] text-right">{m.lastMessageAt ? formatTime(m.lastMessageAt) : ''}</span>
                  </div>
                  <span className="text-[14px] text-[#54656f] dark:text-[#8696a0] truncate text-left w-full">{m.messageCount} total messages stored</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ─── Right Pane (Messaging) ─── */}
      <div className="flex-1 flex flex-col bg-[#efeae2] dark:bg-[#0b141a] relative isolate">
        
        {/* WhatsApp Background Pattern */}
        <div className="absolute inset-0 z-[-1] opacity-40 mix-blend-overlay pointer-events-none" style={{ backgroundImage: 'url("https://static.whatsapp.net/rsrc.php/v3/yl/r/r_QCWqDTeoE.png")', backgroundRepeat: 'repeat', backgroundSize: '400px' }} />

        {selectedChat ? (
          <>
            {/* Chat Window Header */}
            <header className="h-[59px] bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between px-4 flex-shrink-0 shadow-sm border-l border-white/0 dark:border-black/0 z-10 cursor-pointer" onClick={() => setShowMenu(false)}>
              <div className="flex items-center flex-1 min-w-0">
                 <div className="w-10 h-10 rounded-full bg-[#dfe5e7] dark:bg-[#53616a] overflow-hidden flex items-center justify-center text-[#54656f] dark:text-[#aebac1] mr-4 flex-shrink-0">
                   {selectedChat.isGroup ? <Users size={24} /> : <User size={24} />}
                 </div>
                 <div className="flex flex-col flex-1 min-w-0">
                   <h2 className="text-[16px] font-medium truncate dark:text-[#e9edef] text-[#111b21] leading-snug">{selectedChat.name}</h2>
                   <p className="text-[13px] text-[#54656f] dark:text-[#8696a0] truncate">
                     {selectedChat.isGroup ? 'Click here for group info' : 'Click here for contact info'}
                   </p>
                 </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 text-[#54656f] dark:text-[#aebac1] relative">
                 <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                   <Search size={22} />
                 </button>
                 <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }} className={cn("p-2 rounded-full transition-colors", showMenu ? "bg-black/10 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5")}>
                   <MoreVertical size={22} />
                 </button>
                 
                 {/* WhatsApp Style Dropdown Menu */}
                 {showMenu && (
                   <div className="absolute top-12 right-0 bg-white dark:bg-[#233138] rounded shadow-[0_2px_5px_0_rgba(11,20,26,.26),0_2px_10px_0_rgba(11,20,26,.16)] w-52 py-2 origin-top-right text-[#111b21] dark:text-[#d1d7db] font-normal z-50">
                      <button className="w-full text-left px-6 py-3 text-[14.5px] hover:bg-[#f5f6f6] dark:hover:bg-[#182229]">Contact info</button>
                      <button className="w-full text-left px-6 py-3 text-[14.5px] hover:bg-[#f5f6f6] dark:hover:bg-[#182229]">Select messages</button>
                      <button className="w-full text-left px-6 py-3 text-[14.5px] hover:bg-[#f5f6f6] dark:hover:bg-[#182229]">Close chat</button>
                      <div className="my-1 border-t border-[#f0f2f5] dark:border-[#202c33]"></div>
                      <button onClick={(e) => { e.stopPropagation(); toggleMonitor(selectedChat) }} className="w-full text-left px-6 py-3 text-[14.5px] hover:bg-[#f5f6f6] dark:hover:bg-[#182229] flex justify-between items-center text-[#00a884]">
                        {selectedChat.isMonitored ? 'Disable Monitor (AI)' : 'Enable Monitor (AI)'}
                        {selectedChat.isMonitored ? <EyeOff size={16}/> : <Eye size={16}/>}
                      </button>
                   </div>
                 )}
              </div>
            </header>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto px-16 py-4 flex flex-col gap-1 z-0 relative" onClick={() => setShowMenu(false)}>
              {loadingMessages ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 size={28} className="animate-spin text-[#00a884]" />
                </div>
              ) : (
                <>
                  {chatMessages.length === 0 ? (
                     <div className="bg-[#ffeecd] dark:bg-[#182229] dark:text-[#ffffff99] max-w-sm mx-auto text-center px-4 py-2 rounded-lg shadow-sm text-[12.5px] leading-relaxed mb-4 mt-auto">
                        Messages are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Only monitored groups are visible to the EMO Intelligence AI.
                     </div>
                  ) : (
                    chatMessages.map((msg, i) => {
                       const fromMe = msg.fromMe === true || msg.fromMe === "true" || msg.senderName === user?.name || msg.fromName === user?.name
                       const name = msg.senderName || msg.fromName || 'Unknown'
                       const isFirstInSequence = i === 0 || chatMessages[i - 1].senderName !== msg.senderName || chatMessages[i-1].fromMe !== msg.fromMe
                       
                       return (
                         <div key={msg.id} className={cn("flex max-w-[85%] lg:max-w-[70%]", fromMe ? "self-end" : "self-start", isFirstInSequence && i > 0 && "mt-3")}>
                            <div className={cn(
                              "relative px-2 py-1.5 rounded-[7.5px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] flex flex-col text-[14.2px] break-words whitespace-pre-wrap min-w-[100px]",
                              fromMe ? "bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-[0px]" : "bg-white dark:bg-[#202c33] rounded-tl-[0px]"
                            )}>
                               
                               {/* Tail tip for realistic WA UI */}
                               {isFirstInSequence && (
                                  fromMe ? (
                                    <svg viewBox="0 0 8 13" width="8" height="13" className="absolute top-0 -right-[8px] text-[#d9fdd3] dark:text-[#005c4b] fill-current drop-shadow-[1px_1px_0.5px_rgba(11,20,26,.05)]">
                                      <path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z"></path>
                                    </svg>
                                  ) : (
                                    <svg viewBox="0 0 8 13" width="8" height="13" className="absolute top-0 -left-[8px] text-white dark:text-[#202c33] fill-current drop-shadow-[-1px_1px_0.5px_rgba(11,20,26,.05)]">
                                      <path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" transform="scale(-1, 1) translate(-8, 0)"></path>
                                    </svg>
                                  )
                               )}

                               {/* Name Label if not from me and in a group */}
                               {!fromMe && selectedChat?.isGroup && isFirstInSequence && (
                                 <div className="font-semibold text-[12.5px] mb-0.5 leading-none" style={{ color: getSenderColor(name) }}>
                                   {name}
                                 </div>
                               )}
                               
                               <div className="text-[#111b21] dark:text-[#e9edef] pr-10 pb-2">{msg.body}</div>
                               <div className="absolute right-1.5 bottom-1 text-[11px] text-[#667781] dark:text-[#8696a0] leading-none flex items-center gap-1">
                                 {formatTime(msg.timestamp)}
                                 {fromMe && (
                                    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" className="text-[#53bdeb]">
                                      <path d="M11 1.41L12.41 0L17 4.59L12.41 9.17L11 7.76L14.17 4.59L11 1.41Z" fill="currentColor"/>
                                      <path d="M4 4.59L8.59 0L10 1.41L4.59 6.83L0 2.24L1.41 0.83L4 3.41L4 4.59Z" fill="currentColor"/>
                                    </svg>
                                 )}
                               </div>
                            </div>
                         </div>
                       )
                    })
                  )}
                </>
              )}
              <div ref={messagesEndRef} className="h-2 flex-shrink-0" />
            </div>

            {/* Bottom Input Area */}
            <div className="min-h-[62px] px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] flex items-end justify-center z-10 flex-shrink-0 border-t border-white/0 dark:border-black/0" onClick={() => setShowMenu(false)}>
               <div className="flex w-full items-end gap-2 max-w-full">
                  <div className="flex gap-2 pb-2 text-[#54656f] dark:text-[#aebac1]">
                    <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><Smile size={24} strokeWidth={1.5} /></button>
                    <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><Paperclip size={24} strokeWidth={1.5} /></button>
                  </div>
                  
                  <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg border border-transparent focus-within:border-transparent min-h-[42px] max-h-[140px] flex px-3 overflow-hidden shadow-sm my-1">
                    <textarea 
                      placeholder="Type a message" 
                      className="w-full text-[15px] bg-transparent text-[#111b21] dark:text-[#e9edef] my-2.5 py-0 px-1 border-none outline-none resize-none no-scrollbar h-auto max-h-[120px]"
                      rows={1}
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onInput={(e) => {
                        const t = e.target as HTMLTextAreaElement
                        t.style.height = 'auto'
                        t.style.height = Math.min(t.scrollHeight, 120) + 'px'
                        if (t.scrollHeight > 120) { t.style.overflowY = 'auto' } else { t.style.overflowY = 'hidden' }
                      }}
                    />
                  </div>
                  
                  <div className="pb-2 pl-2">
                    {messageInput.trim() ? (
                      <button onClick={handleSendMessage} disabled={sending} className="p-2 text-[#54656f] dark:text-[#aebac1] hover:text-[#00a884] dark:hover:text-[#00a884]">
                        {sending ? <Loader2 size={24} strokeWidth={1.5} className="animate-spin" /> : <Send size={24} strokeWidth={1.5} />}
                      </button>
                    ) : (
                      <button className="p-2 text-[#54656f] dark:text-[#aebac1] hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors"><Radio size={24} strokeWidth={1.5} /></button>
                    )}
                  </div>
               </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 border-l border-white/0 dark:border-[#222d34]">
             <img src="https://static.whatsapp.net/rsrc.php/v3/y6/r/wa66cgO03v.png" alt="WhatsApp Web" className="w-[320px] mb-8 opacity-80" />
             <h1 className="text-[32px] font-light text-[#41525d] dark:text-[#e9edef] mb-4">WhatsApp Web</h1>
             <p className="text-[14px] text-[#667781] dark:text-[#8696a0] max-w-md leading-relaxed mb-8">
               Send and receive messages seamlessly. Keep your phone online to maintain continuity with EMO Intelligence agents.
             </p>
             <div className="text-[13px] text-[#667781] dark:text-[#8696a0] bg-[#f0f2f5] dark:bg-[#182229] px-4 py-1.5 rounded-full flex items-center gap-2">
               <span className="w-2 h-2 rounded-full bg-[#00a884]"></span> Monitored groups feed into AI reports seamlessly.
             </div>
          </div>
        )}
      </div>
    </div>
  )
}
