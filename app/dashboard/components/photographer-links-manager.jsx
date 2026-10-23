'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, Loader2, Plus, Trash2, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { csrfFetch } from '@/lib/client/csrf-fetch'
import { trackEvent } from '@/lib/analytics/track-client'
import {
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_COPIED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED,
} from '@/lib/analytics/events'

const MAX_ACTIVE_LINKS = 10

function linkStatus(link) {
  if (link.revokedAt) return 'revoked'
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return 'expired'
  return 'active'
}

export function PhotographerLinksManager({ event, onOwnerSessionFailure, t, tCommon }) {
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [labelInput, setLabelInput] = useState('')
  const [revealedLink, setRevealedLink] = useState(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  const loadLinks = async () => {
    if (!event?.slug) return
    setLoading(true)
    try {
      const response = await fetch(`/api/owner/events/${event.slug}/photographer-links`, { cache: 'no-store' })
      if (onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t.unableToLoadRoomDetail)
      setLinks(payload.links || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setRevealedLink(null)
    loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.slug])

  const activeCount = links.filter((link) => linkStatus(link) === 'active').length
  const capReached = activeCount >= MAX_ACTIVE_LINKS

  const handleCreate = async () => {
    if (!event?.slug) return
    setCreating(true)
    setError(null)
    try {
      const response = await csrfFetch(`/api/owner/events/${event.slug}/photographer-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelInput.trim() || null }),
      })
      if (onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t.unableToGenerateLink)
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED, { room_slug: event.slug })
      setRevealedLink({ url: payload.url, label: payload.label })
      setLabelInput('')
      setCreateDialogOpen(false)
      await loadLinks()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const handleCopyRevealedLink = async () => {
    if (!revealedLink?.url) return
    try {
      await navigator.clipboard.writeText(revealedLink.url)
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_LINK_COPIED, { room_slug: event?.slug })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(t.unableToCopyLink)
    }
  }

  const handleRevoke = async () => {
    if (!event?.slug || !revokeTarget) return
    setRevokingId(revokeTarget.id)
    setError(null)
    try {
      const response = await csrfFetch(`/api/owner/events/${event.slug}/photographer-links/${revokeTarget.id}`, {
        method: 'DELETE',
      })
      if (onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t.unableToRevokeLink)
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED, { room_slug: event.slug })
      await loadLinks()
    } catch (err) {
      setError(err.message)
    } finally {
      setRevokingId(null)
      setRevokeTarget(null)
    }
  }

  const statusBadge = (status) => {
    if (status === 'active') return <Badge variant="secondary">{t.photographerLinkStatusActive || 'Active'}</Badge>
    if (status === 'expired') return <Badge variant="outline">{t.photographerLinkStatusExpired || 'Expired'}</Badge>
    return <Badge variant="destructive">{t.photographerLinkStatusRevoked || 'Revoked'}</Badge>
  }

  return (
    <div className="mt-5 rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.photographerLink}</span>
          <p className="mt-1 text-xs font-light leading-relaxed text-muted-foreground">{t.photographerLinkDesc}</p>
        </div>
      </div>

      {revealedLink && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <span className="truncate text-xs text-foreground">{revealedLink.url}</span>
          </div>
          <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" onClick={handleCopyRevealedLink}>
            {copied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? t.copied : t.copyLink}
          </Button>
        </div>
      )}

      <div className="mt-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.loading || 'Loading...'}
          </div>
        ) : links.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.noPhotographerLinks || 'No collaborator links yet.'}</p>
        ) : (
          <div className="space-y-2">
            {links.map((link) => {
              const status = linkStatus(link)
              return (
                <div key={link.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{link.label || (t.photographerLinkUnnamed || 'Collaborator')}</p>
                      <p className="mt-0.5 text-xs font-light text-muted-foreground">
                        {(t.photographerLinkPhotoCount || '{count} photos').replace('{count}', link.photoCount ?? 0)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {statusBadge(status)}
                    {status === 'active' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        disabled={revokingId === link.id}
                        onClick={() => setRevokeTarget(link)}
                      >
                        {revokingId === link.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3">
        <Button
          size="sm"
          variant="outline"
          className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark"
          disabled={capReached}
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t.addPhotographerLink || 'Add collaborator'}
        </Button>
        {capReached && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t.photographerLinkCapReached || `Maximum of ${MAX_ACTIVE_LINKS} active links reached.`}
          </p>
        )}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="rounded-xl border-border bg-surface">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-foreground">{t.addPhotographerLink || 'Add collaborator'}</DialogTitle>
            <DialogDescription className="text-sm font-light text-muted-foreground">{t.photographerLinkDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="photographer-link-label">{t.photographerLinkLabel || 'Collaborator name (optional)'}</Label>
            <Input
              id="photographer-link-label"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder={t.photographerLinkLabelPlaceholder || 'e.g. Second photographer'}
              maxLength={60}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border bg-secondary text-foreground hover:bg-elevated" onClick={() => setCreateDialogOpen(false)}>
              {tCommon?.cancel || 'Cancel'}
            </Button>
            <Button className="cta-primary" disabled={creating} onClick={handleCreate}>
              {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t.addPhotographerLink || 'Add collaborator'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="rounded-xl border-border bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-bold text-foreground">{t.revoke}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-light text-muted-foreground">
              {t.photographerLinkRevokeConfirm || 'This collaborator will no longer be able to upload photos with this link.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRevokeTarget(null)} className="border-border bg-secondary text-foreground hover:bg-elevated">
              {tCommon?.cancel || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {revokingId ? <Loader2 className="h-4 w-4 animate-spin" /> : t.revoke}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
