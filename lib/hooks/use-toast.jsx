'use client'

import { useState } from 'react'

export function useToast() {
  const [toast, setToast] = useState(null)
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2000)
  }
  const ToastComponent = () => {
    if (!toast) return null
    return (
      <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-5 py-2.5 text-sm font-medium shadow-xl transition-all font-body ${
        toast.type === 'success' ? 'bg-surface text-foreground border border-border' : 'bg-destructive text-destructive-foreground'
      }`}>
        {toast.message}
      </div>
    )
  }
  return { showToast, ToastComponent }
}
