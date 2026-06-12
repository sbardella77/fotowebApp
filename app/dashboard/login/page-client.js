'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslations } from '@/components/i18n-provider'
import { identifyUser } from '@/lib/analytics/track-client'

export default function LoginPageClient({ redirect = '/dashboard' }) {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const tCommon = useTranslations('common')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

  const safeReadJson = async (response) => {
    const text = await response.text()
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return {}
    }
  }

  const getLoginErrorMessage = (response, payload) => {
    if (payload?.error) return payload.error
    if (response.status === 401) return t.invalidCredentials || t.signInFailed
    if (response.status === 429) return t.tooManyAttempts || t.somethingWentWrong
    if (response.status >= 500 || response.status === 503) return t.loginTemporarilyUnavailable || t.somethingWentWrong
    return t.signInFailed
  }

  const login = async () => {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })

      const payload = await safeReadJson(response)

      if (process.env.NODE_ENV === 'development') {
        console.warn('[login] response', { status: response.status, statusText: response.statusText, ok: response.ok })
      }

      if (!response.ok) {
        throw new Error(getLoginErrorMessage(response, payload))
      }

      identifyUser(payload.email)
      router.push(redirect)
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[login] error', error.message)
      }
      setMessage(error.message || t.loginFailed || t.signInFailed)
    } finally {
      setBusy(false)
    }
  }

  const sendForgotLink = async () => {
    setForgotBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/owner/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || t.somethingWentWrong)
      }
      setForgotSent(true)
    } catch (error) {
      setMessage(error.message || t.somethingWentWrong)
    } finally {
      setForgotBusy(false)
    }
  }

  return (
    <main className="relative min-h-screen bg-background font-body text-foreground">
      <div className="absolute inset-0 bg-grid opacity-[0.02] pointer-events-none" aria-hidden="true" />

      <header className="relative z-10 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="container flex h-16 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle">
              <Camera className="h-[18px] w-[18px]" />
            </div>
            <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
          </a>
          <Button size="sm" variant="ghost" asChild className="text-muted-foreground">
            <a href="/">{tCommon.back}</a>
          </Button>
        </div>
      </header>

      <div className="relative z-10 flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Camera className="h-8 w-8" />
            </div>
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-foreground">
              {forgotMode ? t.resetYourPassword : t.signInToManage}
            </h1>
            <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">
              {forgotMode ? t.enterEmailForReset : t.accessYourRooms}
            </p>
          </div>

          {forgotMode ? (
            <div className="surface-elevated rounded-xl shadow-card p-6">
              <div className="space-y-4">
                {forgotSent ? (
                  <div className="rounded-xl border border-border bg-raised p-4 text-sm text-muted-foreground text-center">
                    {t.resetSent}
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">{t.emailLabel}</label>
                      <Input
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder={t.emailPlaceholder}
                        className="h-11 rounded-lg border-input bg-surface text-foreground placeholder:text-muted-foreground"
                        onKeyDown={(e) => { if (e.key === 'Enter' && forgotEmail.trim()) sendForgotLink() }}
                      />
                    </div>
                    {message && <p className="text-sm text-destructive">{message}</p>}
                    <Button className="cta-primary w-full h-11" disabled={forgotBusy || !forgotEmail.trim()} onClick={sendForgotLink}>
                      {forgotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.sendResetLink}
                    </Button>
                  </>
                )}
                <div className="text-center pt-2">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
                    onClick={() => { setForgotMode(false); setForgotEmail(''); setForgotSent(false); setMessage('') }}
                  >
                    {t.backToSignIn}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="surface-elevated rounded-xl shadow-card p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.emailLabel}</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.emailPlaceholder}
                    className="h-11 rounded-lg border-input bg-surface text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.passwordLabel}</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.passwordPlaceholder}
                      className="h-11 rounded-lg border-input bg-surface text-foreground placeholder:text-muted-foreground"
                      onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && password) login() }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {message && <p className="text-sm text-destructive">{message}</p>}
                <Button className="cta-primary w-full h-11" disabled={busy || !email.trim() || !password} onClick={login}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.signIn}
                </Button>
                <div className="text-center pt-1">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
                    onClick={() => { setForgotMode(true); setMessage(''); if (email.trim()) setForgotEmail(email.trim()) }}
                  >
                    {t.forgotPassword}
                  </button>
                </div>
              </div>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            {t.noRoomsYet}{' '}
            <a href="/" className="underline underline-offset-2 hover:text-foreground transition-colors">
              {t.createYourRoom}
            </a>
          </p>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
          </p>
        </div>
      </div>
    </main>
  )
}
