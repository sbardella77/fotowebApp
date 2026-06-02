'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Pencil, Check, X, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EventMomentsManager({ event, t }) {
  const [moments, setMoments] = useState(event?.moments || [])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const fetchMoments = useCallback(async () => {
    if (!event?.slug) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/owner/events/${event.slug}/moments`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load moments')
      const data = await res.json()
      setMoments(data.moments || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [event?.slug])

  useEffect(() => {
    // Sync with event prop if available
    if (event?.moments) {
      setMoments(event.moments)
    }
  }, [event?.moments])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name || name.length > 40) return
    setCreating(true)
    setError('')
    try {
      const res = await fetch(`/api/owner/events/${event.slug}/moments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create moment')
      }
      const data = await res.json()
      setMoments((prev) => [...prev, data.moment])
      setNewName('')
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const handleRename = async (momentId) => {
    const name = editName.trim()
    if (!name || name.length > 40) return
    setBusyId(momentId)
    setError('')
    try {
      const res = await fetch(`/api/owner/events/${event.slug}/moments/${momentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to rename moment')
      }
      const data = await res.json()
      setMoments((prev) => prev.map((m) => (m.id === momentId ? data.moment : m)))
      setEditingId(null)
      setEditName('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (momentId) => {
    if (!confirm(t.deleteMomentConfirm || 'Delete this moment? Photos will not be deleted.')) return
    setBusyId(momentId)
    setError('')
    try {
      const res = await fetch(`/api/owner/events/${event.slug}/moments/${momentId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete moment')
      }
      setMoments((prev) => prev.filter((m) => m.id !== momentId))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const startEdit = (moment) => {
    setEditingId(moment.id)
    setEditName(moment.name)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.moments || 'Moments'}</p>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 space-y-2">
        {moments.map((moment) => (
          <div key={moment.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            {editingId === moment.id ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={40}
                  className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-accent-dark"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(moment.id)
                    if (e.key === 'Escape') cancelEdit()
                  }}
                />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleRename(moment.id)} disabled={busyId === moment.id}>
                  {busyId === moment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelEdit}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{moment.name}</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={() => startEdit(moment)} disabled={busyId === moment.id}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(moment.id)} disabled={busyId === moment.id}>
                    {busyId === moment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}

        {moments.length === 0 && !loading && (
          <div className="rounded-lg border border-dashed border-border bg-background p-4 text-center">
            <p className="text-xs text-muted-foreground">{t.noMomentsYet || 'No moments yet. Add your first moment to organize photos.'}</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t.momentNamePlaceholder || 'Moment name'}
          maxLength={40}
          className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-accent-dark"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
          }}
        />
        <Button size="sm" className="h-9 gap-1 cta-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {t.addMoment || 'Add'}
        </Button>
      </div>

      {moments.length >= 12 && (
        <p className="mt-2 text-xs text-muted-foreground">{t.maxMomentsReached || 'Maximum 12 moments reached.'}</p>
      )}
    </div>
  )
}
