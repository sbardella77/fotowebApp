'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { identifyUser } from '@/lib/analytics/track-client'
import { useTranslations } from '@/components/i18n-provider'

export default function LoginPageClient({ redirect }) {
  const t = useTranslations('auth')
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const passwordRef = useRef(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)

    try {
      const response = await fetch('/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || t.signInFailed)
      }

      identifyUser(email.trim())

      if (redirect && redirect.startsWith('/')) {
        router.push(redirect)
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setError(err.message || t.signInFailed)
      setBusy(false)
    }
  }

  const handleForgot = async () => {
    if (!email.trim()) {
      setError(t.enterEmailFirst)
      return
    }
    setError('')
    setBusy(true)

    try {
      const response = await fetch('/api/owner/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || t.unableToSendReset)
      }

      setForgotSent(true)
    } catch (err) {
      setError(err.message || t.unableToSendReset)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="dark relative flex min-h-screen flex-col bg-background font-body text-foreground">
      <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </a>
          <a
            href="/"
            className="text-sm font-light text-muted-foreground transition-colors hover:text-foreground"
          >
            {t.backToHome}
          </a>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Login card */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
            <div className="p-6 sm:p-8">
              <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                {t.ownerAccess}
              </span>
              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {t.signInToManage}
              </h1>
              <p className="mt-2 text-sm font-light text-muted-foreground">
                {t.accessYourRooms}
              </p>

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.emailLabel}</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        passwordRef.current?.focus()
                      }
                    }}
                    placeholder={t.emailPlaceholder}
                    disabled={busy}
                    required
                    autoFocus
                    className="h-11 border-white/[0.07] bg-[#0D1220] text-foreground placeholder:text-muted-foreground/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.passwordLabel}</label>
                  <div className="relative">
                    <Input
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.passwordPlaceholder}
                      disabled={busy}
                      required
                      className="h-11 border-white/[0.07] bg-[#0D1220] pr-10 text-foreground placeholder:text-muted-foreground/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm font-light text-red-400">
                    {error}
                  </div>
                )}

                {forgotSent && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm font-light text-emerald-400">
                    {t.resetSent}
                  </div>
                )}

                <Button
                  type="submit"
                  className="h-11 w-full glow-blue"
                  disabled={busy || !email.trim() || !password}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.signIn}
                </Button>

                <p className="text-center text-xs font-light text-muted-foreground/70">
                  {t.trustNote}
                </p>
              </form>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={handleForgot}
                  disabled={busy}
                  className="text-sm font-light text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {t.forgotPassword}
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 space-y-2 text-center">
            <p className="text-xs font-light text-muted-foreground">
              {t.noRoomsYet}{' '}
              <a href="/" className="text-primary transition-colors hover:underline">
                {t.createYourFirstRoom}
              </a>
            </p>
            <p className="text-xs font-light text-muted-foreground/70">
              <a href="/privacy" className="transition-colors hover:text-muted-foreground">
                {t.privacyPolicy}
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
