'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, Lock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function ResetPasswordPageClient({ token }) {
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [valid, setValid] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Missing reset token')
      setChecking(false)
      return
    }

    fetch(`/api/owner/reset-password?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setValid(true)
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
      const response = await fetch('/api/owner/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to reset password')
      }

      router.push('/dashboard')
    } catch (err) {
      setError(err.message || 'Unable to reset password')
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (!valid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Link expired</CardTitle>
            <CardDescription>{error || 'This reset link is no longer valid.'}</CardDescription>
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
              <RefreshCw className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a new password for your account.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lock className="h-5 w-5 text-primary" />
                New password
              </CardTitle>
              <CardDescription>
                Make it strong and memorable.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">New password</label>
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
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reset password & sign in'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

function validatePassword(password) {
  const errors = []
  if (password.length < 12) errors.push('At least 12 characters')
  if (!/[A-Z]/.test(password)) errors.push('One uppercase letter')
  if (!/[a-z]/.test(password)) errors.push('One lowercase letter')
  if (!/[0-9]/.test(password)) errors.push('One number')
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('One symbol')
  return { valid: errors.length === 0, errors }
}
