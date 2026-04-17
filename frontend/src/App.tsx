import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import AppShell from '@/components/layout/AppShell'
import Login from '@/app/routes/login'
import DashboardHome from '@/app/routes/dashboard/index'
import DashboardFleet from '@/app/routes/dashboard/fleet'
import Chat from '@/app/routes/chat/index'
import SchedulePage from '@/app/routes/schedule/index'
import WhatsAppPage from '@/app/routes/whatsapp/index'
import ProfileSettings from '@/app/routes/settings/profile'
import SystemSettings from '@/app/routes/settings/system'
import ProgramManagerPanel from '@/app/routes/settings/program-manager'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* App shell with sidebar nav — all protected */}
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardHome />} />
        <Route path="/dashboard/fleet" element={<DashboardFleet />} />
        <Route path="/dashboard/battery" element={<DashboardFleet />} />
        <Route path="/dashboard/complaints" element={<DashboardFleet />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/whatsapp" element={<WhatsAppPage />} />
        <Route path="/settings" element={<ProfileSettings />} />
        <Route path="/settings/system" element={<SystemSettings />} />
        <Route path="/settings/pm" element={<ProgramManagerPanel />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
