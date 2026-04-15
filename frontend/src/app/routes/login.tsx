import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Zap, ArrowRight, Loader2, Mail } from 'lucide-react'

export default function Login() {
  const [showEmailLogin, setShowEmailLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError('')
    setGoogleLoading(true)
    try {
      const data = await api.post<{
        token: string
        user: { id: string; email: string; name: string; role: string; orgNode: string }
      }>('/auth/google', { credential: credentialResponse.credential })

      setAuth(data.token, {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        role: data.user.role,
        orgNode: data.user.orgNode,
      })
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.post<{
        token: string
        user: { id: string; email: string; name: string; role: string; orgNode: string }
      }>('/auth/login', { email, password })

      setAuth(data.token, {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        role: data.user.role,
        orgNode: data.user.orgNode,
      })
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[60%] h-[60%] rounded-full bg-primary/[0.04] blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[20%] w-[50%] h-[50%] rounded-full bg-accent/[0.03] blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-[380px] px-6">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent-soft border border-border mb-5">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">EMO Intelligence</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Operational Intelligence Platform</p>
        </div>

        {/* Login Card */}
        <Card className="backdrop-blur-xl bg-card/80 shadow-2xl shadow-black/20">
          <CardContent className="pt-6 space-y-4">
            {/* Google Sign In — Primary */}
            <div id="google-signin-wrapper">
              <GoogleSignInButton
                onSuccess={handleGoogleSuccess}
                loading={googleLoading}
              />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-[11px] text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            {/* Email/Password — Secondary */}
            {!showEmailLogin ? (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowEmailLogin(true)}
              >
                <Mail size={16} />
                Sign in with email
              </Button>
            ) : (
              <form onSubmit={handleEmailLogin} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
                    Email
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder="you@emoenergy.in"
                    className="bg-background/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
                    Password
                  </label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Enter password"
                    className="bg-background/50"
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full" size="lg">
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="w-3.5 h-3.5 ml-2" />
                    </>
                  )}
                </Button>
                <button
                  type="button"
                  onClick={() => setShowEmailLogin(false)}
                  className="w-full text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back to other options
                </button>
              </form>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-8 flex justify-center">
          <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal tracking-wider border-border/50">
            EMO OPS INTELLIGENCE v3.0
          </Badge>
        </div>
      </div>
    </div>
  )
}

// Custom Google button that matches our dark theme
function GoogleSignInButton({
  onSuccess,
  loading,
}: {
  onSuccess: (response: any) => void
  loading: boolean
}) {
  // Use the Google One Tap / credential response
  // We render Google's own button for the best UX
  return (
    <div className="space-y-2">
      <GoogleButtonRenderer onSuccess={onSuccess} loading={loading} />
    </div>
  )
}

function GoogleButtonRenderer({
  onSuccess,
  loading,
}: {
  onSuccess: (response: any) => void
  loading: boolean
}) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  // If no client ID configured, show a disabled state
  if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
    return (
      <Button variant="outline" className="w-full gap-2" disabled>
        <GoogleIcon />
        Google Sign-in (configure Client ID)
      </Button>
    )
  }

  // Use the credential callback approach
  // Google's Identity Services library handles the button rendering
  return (
    <>
      <GoogleCredentialButton onSuccess={onSuccess} loading={loading} clientId={clientId} />
    </>
  )
}

function GoogleCredentialButton({
  onSuccess,
  loading,
  clientId,
}: {
  onSuccess: (response: any) => void
  loading: boolean
  clientId: string
}) {
  // We'll use a custom styled button that triggers Google's popup
  const handleClick = () => {
    // @ts-ignore — google.accounts.id is loaded via the @react-oauth/google provider
    if (window.google?.accounts?.id) {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: onSuccess,
      })
      window.google.accounts.id.prompt()
    }
  }

  return (
    <Button
      variant="outline"
      className="w-full gap-2.5 h-11 text-[13px] font-medium"
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <GoogleIcon />
      )}
      {loading ? 'Signing in...' : 'Continue with Google'}
    </Button>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  )
}

// Extend Window for Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void
          prompt: (callback?: any) => void
          renderButton: (element: HTMLElement, config: any) => void
        }
      }
    }
  }
}
