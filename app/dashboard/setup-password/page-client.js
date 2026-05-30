'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslations } from '@/components/i18n-provider'

function generateStrongPassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
  let pwd = ''
  for (let i = 0; i < 16; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  return pwd
}

export default function SetupPasswordPageClient({ token }) {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const tCommon = useTranslations('common')
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch(`/api/owner/setup?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.email) { setEmail(data.email); setInvalid(false) } else { setInvalid(true) }
        setChecking(false)
      })
      .catch(() => { setInvalid(true); setChecking(false) })
  }, [token])

  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasNumber = /\d/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)
  const isLongEnough = password.length >= 12
  const strengthOk = hasUpper && hasLower && hasNumber && hasSymbol && isLongEnough
  const matches = password && password === confirm

  const submit = async () => {
    if (!strengthOk || !matches) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/owner/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t.somethingWentWrong)
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 2000)
    } catch (error) {
      setMessage(error.message || t.somethingWentWrong)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative min-h-screen bg-background font-body text-foreground">
      <div className="absolute inset-0 bg-grid opacity-[0.02] pointer-events-none" aria-hidden="true" />
      <header className="relative z-10 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle"><Camera className="h-[18px] w-[18px]" /></div>
            <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
          </a>
        </div>
      </header>
      <div className="relative z-10 flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          {checking ? (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{tCommon.loading}</p>
            </div>
          ) : invalid ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
              <XCircle className="mx-auto h-10 w-10 text-destructive" />
              <h2 className="mt-4 font-display text-xl font-bold text-foreground">{t.linkExpired}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t.linkExpiredDesc}</p>
              <Button className="mt-6 cta-primary" asChild>
                <a href="/dashboard/login">{t.backToSignIn}</a>
              </Button>
            </div>
          ) : done ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
              <h2 className="mt-4 font-display text-xl font-bold text-foreground">{t.passwordSet}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t.redirectingToDashboard}</p>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-foreground">{t.setYourPassword}</h1>
                <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">
                  {t.welcomeToSnapRooms} {email}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-6 shadow-card space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.newPassword}</label>
                  <div className="relative">
                    <Input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.passwordPlaceholder} className="h-11 rounded-xl border-border bg-raised text-foreground placeholder:text-muted-foreground" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.confirmPassword}</label>
                  <Input type={showPassword ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t.confirmPasswordPlaceholder} className="h-11 rounded-xl border-border bg-raised text-foreground placeholder:text-muted-foreground" />
                </div>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className={`flex items-center gap-1.5 ${isLongEnough ? 'text-accent-dark' : ''}`}><CheckCircle2 className={`h-3 w-3 ${isLongEnough ? 'text-accent-dark opacity-100' : 'text-muted-foreground opacity-40'}`} /> {t.min12Chars}</div>
                  <div className={`flex items-center gap-1.5 ${hasUpper ? 'text-accent-dark' : ''}`}><CheckCircle2 className={`h-3 w-3 ${hasUpper ? 'text-accent-dark opacity-100' : 'text-muted-foreground opacity-40'}`} /> {t.uppercaseLetter}</div>
                  <div className={`flex items-center gap-1.5 ${hasLower ? 'text-accent-dark' : ''}`}><CheckCircle2 className={`h-3 w-3 ${hasLower ? 'text-accent-dark opacity-100' : 'text-muted-foreground opacity-40'}`} /> {t.lowercaseLetter}</div>
                  <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-accent-dark' : ''}`}><CheckCircle2 className={`h-3 w-3 ${hasNumber ? 'text-accent-dark opacity-100' : 'text-muted-foreground opacity-40'}`} /> {t.number}</div>
                  <div className={`flex items-center gap-1.5 ${hasSymbol ? 'text-accent-dark' : ''}`}><CheckCircle2 className={`h-3 w-3 ${hasSymbol ? 'text-accent-dark opacity-100' : 'text-muted-foreground opacity-40'}`} /> {t.specialCharacter}</div>
                </div>
                {message && <p className="text-sm text-destructive">{message}</p>}
                <Button className="w-full h-11 cta-primary" disabled={busy || !strengthOk || !matches} onClick={submit}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.createPassword}
                </Button>
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground hover:text-foreground" onClick={() => { const pwd = generateStrongPassword(); setPassword(pwd); setConfirm(pwd) }}>
                  {t.generateStrongPassword}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
