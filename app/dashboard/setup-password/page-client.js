'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, Lock, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { generateStrongPassword, validatePassword } from '@/lib/password-utils'

export default function SetupPasswordPageClient({ token }) {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!token) {
      setError('Missing setup token')
      setChecking(false)
      return
    }

    fetch(`/api/owner/setup?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.email) {
          setEmail(data.email)
        } else {
          setError(data.error || 'Invalid or expired link')
        }
      })
      .catch(() => setError('Unable to verify link'))
      .finally(() => setChecking(false))
  }, [token])

  const strength = validatePassword(password)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!strength.valid) {
      setError(`Password must have: ${strength.errors.join(', ')}`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/owner/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to set password')
      }

      router.push('/dashboard')
    } catch (err) {
      setError(err.message || 'Unable to set password')
      setBusy(false)
    }
  }

  const generate = () => {
    const pw = generateStrongPassword()
    setPassword(pw)
    setConfirm(pw)
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (!email) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Link expired</CardTitle>
            <CardDescription>{error || 'This setup link is no longer valid.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href="/dashboard/login">Go to sign in</a>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2">
            <img src="/snaprooms-logo.svg" alt="SnapRooms" className="h-8 w-8 rounded-md object-cover" />
            <span className="font-semibold tracking-tight">SnapRooms</span>
          </a>
        </div>
      </header>

      <div className="container flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Lock className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Set your password</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a secure password for <strong>{email}</strong>.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" />
                Secure your account
              </CardTitle>
              <CardDescription>
                One password for all your rooms.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Password</label>
                    <button
                      type="button"
                      onClick={generate}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Wand2 className="h-3 w-3" />
                      Generate strong
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a strong password"
                      disabled={busy}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Confirm password</label>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    disabled={busy}
                    required
                  />
                </div>

                {password.length > 0 && (
                  <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
                    <p className="font-medium text-muted-foreground">Password requirements:</p>
                    <ul className="space-y-0.5">
                      {[
                        { label: 'At least 12 characters', pass: password.length >= 12 },
                        { label: 'One uppercase letter', pass: /[A-Z]/.test(password) },
                        { label: 'One lowercase letter', pass: /[a-z]/.test(password) },
                        { label: 'One number', pass: /[0-9]/.test(password) },
                        { label: 'One symbol', pass: /[^A-Za-z0-9]/.test(password) },
                      ].map((req) => (
                        <li key={req.label} className={`flex items-center gap-1.5 ${req.pass ? 'text-green-600' : 'text-muted-foreground'}`}>
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${req.pass ? 'bg-green-600' : 'bg-muted-foreground/40'}`} />
                          {req.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set password & sign in'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
