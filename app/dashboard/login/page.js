'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Camera, Eye, EyeOff, Loader2, Lock, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forgotSent, setForgotSent] = useState(false)

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
        throw new Error(payload.error || 'Sign in failed')
      }

      if (redirect && redirect.startsWith('/')) {
        router.push(redirect)
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setError(err.message || 'Sign in failed')
      setBusy(false)
    }
  }

  const handleForgot = async () => {
    if (!email.trim()) {
      setError('Enter your email first')
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
        throw new Error(payload.error || 'Unable to send reset link')
      }

      setForgotSent(true)
    } catch (err) {
      setError(err.message || 'Unable to send reset link')
    } finally {
      setBusy(false)
    }
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
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to your rooms</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter your email and password to manage your rooms.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <LogIn className="h-5 w-5 text-primary" />
                Owner sign in
              </CardTitle>
              <CardDescription>
                One account for all your rooms.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={busy}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Password</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
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

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                {forgotSent && (
                  <p className="text-sm text-green-600">
                    If that email is linked to an account, we&apos;ve sent a reset link.
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={busy || !email.trim() || !password}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                </Button>
              </form>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={handleForgot}
                  disabled={busy}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Don&apos;t have rooms yet?{' '}
            <a href="/" className="underline hover:text-foreground">
              Create your first room
            </a>
          </p>
        </div>
      </div>
    </main>
  )
}
