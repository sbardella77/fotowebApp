'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/components/i18n-provider'
import { csrfFetch } from '@/lib/client/csrf-fetch'
import { safeFetchJson } from '@/lib/dashboard-data-helpers'
import {
  classifyOwnerApiFailure,
  createOwnerSessionExpiryGate,
  OWNER_SESSION_EXPIRED_QUERY_PARAM,
} from '@/lib/client/owner-session-expiry'

export default function AccountSettingsPage() {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const [auth, setAuth] = useState({ loading: true, ok: false })
  const [enabled, setEnabled] = useState(true)
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const sessionExpiryGateRef = useRef(null)
  if (!sessionExpiryGateRef.current) {
    sessionExpiryGateRef.current = createOwnerSessionExpiryGate()
  }

  const checkOwnerSessionStillValid = useCallback(async () => {
    const response = await fetch('/api/owner/session', { cache: 'no-store' })
    const { payload } = await safeFetchJson(response, { fallback: { authenticated: false } })
    return Boolean(payload.authenticated)
  }, [])

  const handleOwnerSessionExpired = useCallback(() => {
    router.replace(`/dashboard?${OWNER_SESSION_EXPIRED_QUERY_PARAM}=1`, { scroll: false })
  }, [router])

  const consumeOwnerSessionFailure = useCallback(async (status) => {
    if (classifyOwnerApiFailure(status) !== 'SESSION_EXPIRED') return false
    await sessionExpiryGateRef.current.handleCandidate401(checkOwnerSessionStillValid, handleOwnerSessionExpired)
    return true
  }, [checkOwnerSessionStillValid, handleOwnerSessionExpired])

  useEffect(() => {
    fetch('/api/owner/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) setAuth({ loading: false, ok: true })
        else router.push('/dashboard')
      })
      .catch(() => router.push('/dashboard'))
  }, [router])

  useEffect(() => {
    if (!auth.ok) return
    const run = async () => {
      setPrefsLoading(true)
      try {
        const response = await fetch('/api/owner/account/notifications', { cache: 'no-store' })
        if (await consumeOwnerSessionFailure(response.status)) return
        const { payload } = await safeFetchJson(response, { fallback: { emailNotificationsEnabled: true } })
        setEnabled(Boolean(payload.emailNotificationsEnabled))
      } catch {
        setError(t.accountSettingsLoadError || 'Unable to load your notification settings.')
      } finally {
        setPrefsLoading(false)
      }
    }
    run()
  }, [auth.ok, consumeOwnerSessionFailure, t.accountSettingsLoadError])

  const handleToggle = async (next) => {
    setEnabled(next)
    setSaving(true)
    setError(null)
    try {
      const response = await csrfFetch('/api/owner/account/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (await consumeOwnerSessionFailure(response.status)) return
      const { payload } = await safeFetchJson(response, { fallback: {} })
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save your preference')
      }
      setEnabled(Boolean(payload.emailNotificationsEnabled))
    } catch (err) {
      setEnabled(!next)
      setError(err.message || t.accountSettingsSaveError || 'Unable to save your notification settings.')
    } finally {
      setSaving(false)
    }
  }

  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      <header className="border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="container flex h-16 items-center gap-3 px-4">
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground" onClick={() => router.push('/dashboard')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-display text-base font-bold tracking-tight text-foreground">
            {t.accountSettingsTitle || 'Account settings'}
          </h1>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-xl border border-border bg-surface p-5 shadow-subtle">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-accent-dark">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t.accountSettingsEmailNotificationsTitle || 'Email notifications'}
                </p>
                <p className="mt-1 max-w-sm text-xs font-light text-muted-foreground">
                  {t.accountSettingsEmailNotificationsDesc || 'New-photo digests, photo-limit alerts, and storage expiry reminders for your events.'}
                </p>
              </div>
            </div>
            <Switch
              checked={enabled}
              disabled={prefsLoading || saving}
              onCheckedChange={handleToggle}
              aria-label={t.accountSettingsEmailNotificationsTitle || 'Email notifications'}
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-destructive">{error}</p>
        )}
      </main>
    </div>
  )
}
