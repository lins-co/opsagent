import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import GoogleCalendar from '@/components/dashboard/GoogleCalendar'
import {
  BarChart3,
  Battery,
  AlertTriangle,
  Wrench,
  MessageSquareText,
  CalendarClock,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const STATS = [
  { label: 'Fleet Vehicles', value: '42 Active', valueColor: 'text-foreground', icon: BarChart3, iconColor: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/10' },
  { label: 'Battery Packs', value: 'Healthy', valueColor: 'text-emerald-600 dark:text-emerald-400', icon: Battery, iconColor: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  { label: 'Open Complaints', value: '3 Critical', valueColor: 'text-amber-600 dark:text-amber-400', icon: AlertTriangle, iconColor: 'text-amber-500 dark:text-amber-400', bg: 'bg-amber-500/10' },
  { label: 'Service Logs', value: '12 Pending', valueColor: 'text-purple-600 dark:text-purple-400', icon: Wrench, iconColor: 'text-purple-500 dark:text-purple-400', bg: 'bg-purple-500/10' },
]

const QUICK_LINKS = [
  { label: 'Fleet Health', desc: 'Vehicle status, faults, idle time', to: '/dashboard/fleet', icon: BarChart3, color: 'text-blue-500' },
  { label: 'Battery Risk', desc: 'SoH, degradation, firmware impact', to: '/dashboard/battery', icon: Battery, color: 'text-emerald-500' },
  { label: 'Complaints', desc: 'Rider issues, trends, resolution', to: '/dashboard/complaints', icon: AlertTriangle, color: 'text-amber-500' },
  { label: 'Ask AI', desc: 'Chat with the intelligence layer', to: '/chat', icon: MessageSquareText, color: 'text-primary' },
  { label: 'Schedule Reports', desc: 'Automated report delivery', to: '/schedule', icon: CalendarClock, color: 'text-pink-500' },
]

export default function DashboardHome() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="h-full overflow-y-auto no-scrollbar scroll-smooth">
      <div className="max-w-[1400px] mx-auto px-8 py-10">
        
        {/* Header section with glass gradient */}
        <div className="relative mb-10 overflow-hidden rounded-3xl glass-panel p-8 border-border/40">
           <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 z-0"></div>
           <div className="absolute bottom-0 left-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl translate-y-1/2 z-0"></div>
           
           <div className="relative z-10">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              {greeting}, <span className="text-primary">{user?.name?.split(' ')[0] || 'Admin'}</span>
            </h1>
            <p className="text-[15px] text-muted-foreground mt-2 max-w-lg leading-relaxed">
              Welcome back to EMO Intelligence. Here's a real-time overview of your fleet operations and agent networks.
            </p>
           </div>
        </div>

        {/* Multi-column masonry-like grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column (Spans 8 cols) */}
          <div className="col-span-1 lg:col-span-8 space-y-6">
            
            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {STATS.map((stat, i) => (
                <div key={i} className="glass-panel subtle-hover rounded-2xl p-5 border border-border/40 flex flex-col justify-between">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={cn('w-10 h-10 rounded-[14px] flex items-center justify-center shadow-inner', stat.bg)}>
                      <stat.icon size={20} className={stat.iconColor} />
                    </div>
                  </div>
                  <div>
                    <p className={cn("text-lg font-semibold leading-none", stat.valueColor)}>{stat.value}</p>
                    <p className="text-[12px] font-medium text-muted-foreground mt-1.5">{stat.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* System Status Hero Card */}
            <div className="glass-panel subtle-hover border border-border/40 rounded-2xl p-6 relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-r from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
               <div className="flex items-start gap-4 relative z-10">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                    <ShieldCheck size={24} className="text-emerald-500" />
                  </div>
                  <div className="flex-1 mt-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-[16px] font-semibold">System Operational</h3>
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-600 dark:text-emerald-400 font-bold tracking-wider uppercase">
                         <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                         Live
                      </span>
                    </div>
                    <p className="text-[13px] text-muted-foreground leading-relaxed max-w-2xl">
                      All autonomous multi-agent routing systems are fully active. MongoDB event logs and Neon PostgreSQL relations are stable. No latency anomalies detected across regions.
                    </p>
                  </div>
               </div>
            </div>

            {/* Quick Links Grid */}
            <div>
              <h2 className="text-[14px] font-semibold mb-4 px-1 flex items-center gap-2">
                 Quick Access
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {QUICK_LINKS.map((link) => (
                  <button
                    key={link.to}
                    onClick={() => navigate(link.to)}
                    className="group relative flex flex-col items-start gap-3 p-5 rounded-2xl border border-border/40 glass-panel hover:bg-card/80 subtle-hover text-left overflow-hidden"
                  >
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-secondary/50 group-hover:scale-110 transition-transform duration-300", link.color.replace('text-', 'bg-').replace('-500', '-500/10'))}>
                      <link.icon size={20} className={cn(link.color)} />
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold group-hover:text-primary transition-colors">{link.label}</p>
                      <p className="text-[12px] text-muted-foreground mt-1 line-clamp-2">{link.desc}</p>
                    </div>
                    <ArrowRight size={16} className="absolute right-5 bottom-5 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-primary" />
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Right Column (Spans 4 cols) - Sticky Calendar */}
          <div className="col-span-1 lg:col-span-4 h-full relative">
            <div className="sticky top-0 glass-panel rounded-3xl border border-border/40 overflow-hidden shadow-sm">
               <GoogleCalendar />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
