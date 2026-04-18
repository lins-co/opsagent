import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/utils'
import {
  Zap,
  LayoutDashboard,
  MessageSquareText,
  CalendarClock,
  MessageCircle,
  BarChart3,
  Battery,
  AlertTriangle,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Settings,
  Bell,
  Search,
  Target,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/theme-toggle'
import MuteBanner from '@/components/MuteBanner'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/chat', label: 'Intelligence Chat', icon: MessageSquareText },
  { to: '/schedule', label: 'Automations', icon: CalendarClock },
  { to: '/whatsapp', label: 'WhatsApp Connect', icon: MessageCircle },
  { to: '/settings/pm', label: 'Program Manager', icon: Target },
]

const INSIGHTS = [
  { to: '/dashboard/fleet', label: 'Fleet Health', icon: BarChart3 },
  { to: '/dashboard/battery', label: 'Battery Risk', icon: Battery },
  { to: '/dashboard/complaints', label: 'Rider Complaints', icon: AlertTriangle },
]

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden selection:bg-primary/20">
      {/* ─── Sidebar ─── */}
      <aside
        className={cn(
          'relative flex flex-col border-r border-border/40 bg-sidebar/50 backdrop-blur-xl transition-all duration-300 ease-in-out flex-shrink-0 z-20',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Brand */}
        <div className={cn('flex items-center gap-3 px-4 h-16', collapsed && 'justify-center px-0')}>
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/20 flex-shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          {!collapsed && <span className="text-[14px] font-semibold tracking-tight truncate">EMO Intelligence</span>}
        </div>

        {/* Global Search (Fake) */}
        {!collapsed && (
          <div className="px-3 pb-2 mt-2">
            <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-input/40 border border-border/50 text-[13px] text-muted-foreground hover:bg-input/80 transition-colors shadow-sm">
              <Search size={14} />
              <span>Search...</span>
              <kbd className="ml-auto pointer-events-none inline-flex h-5 items-center gap-1 rounded border border-border/60 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto no-scrollbar">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200',
                  collapsed && 'justify-center px-0 py-3',
                  isActive
                    ? 'bg-primary/10 text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={16} className={cn('flex-shrink-0 transition-transform duration-200', isActive ? 'scale-110 text-primary' : 'group-hover:text-foreground')} />
                  {!collapsed && <span>{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}

          {!collapsed && (
            <div className="mt-6 mb-2">
              <p className="px-3 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
                Platform Insights
              </p>
            </div>
          )}
          {collapsed && <Separator className="my-4 w-8 mx-auto bg-border/40" />}

          {INSIGHTS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200',
                  collapsed && 'justify-center px-0 py-3',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={16} className={cn('flex-shrink-0 transition-transform duration-200', isActive ? 'scale-110 text-primary' : 'group-hover:text-foreground')} />
                  {!collapsed && <span>{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-border/40 space-y-1">
          <NavLink
             to="/settings"
             className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors',
                  collapsed && 'justify-center px-0 py-3',
                  isActive && 'bg-primary/10 text-primary'
                )
              }
            >
            <Settings size={16} className="flex-shrink-0" />
            {!collapsed && <span>Settings</span>}
          </NavLink>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors',
              collapsed && 'justify-center px-0 py-3'
            )}
          >
            {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ─── Main Content Wrapper ─── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/50">
        
        {/* ─── Top Header ─── */}
        <header className="h-16 border-b border-border/40 bg-background/80 backdrop-blur-md flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4">
            {/* Can put breadcrumbs here later if wanted */}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            
            <button className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground transition-all hover:bg-secondary subtle-hover">
              <Bell size={15} />
              <span className="absolute top-1.5 right-2 w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            </button>

            <Separator orientation="vertical" className="h-4 mx-1 bg-border/60" />

            {/* Profile Menu */}
            <div className="flex items-center gap-2 pl-1 cursor-pointer group">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-primary/5 flex items-center justify-center text-[12px] font-semibold text-primary border border-primary/20 group-hover:border-primary/40 transition-colors flex-shrink-0">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="hidden md:block text-left mr-1">
                <p className="text-[12px] font-medium leading-none">{user?.name || 'User'}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{user?.role || 'Admin'}</p>
              </div>
              <button onClick={handleLogout} className="p-1.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Sign out">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </header>

        {/* ─── Mute Banner (global) ─── */}
        <MuteBanner />

        {/* ─── Page Outlet ─── */}
        <main className="flex-1 overflow-hidden relative">
           <Outlet />
        </main>
      </div>
    </div>
  )
}
