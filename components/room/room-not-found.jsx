'use client'

import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'

export function RoomNotFound() {
  const t = useTranslations('room')
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Camera className="h-7 w-7" />
      </div>
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{t.roomNotFound}</h1>
        <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">{t.roomNotFoundDesc}</p>
        <p className="mt-1 text-sm font-light text-muted-foreground">{t.roomNotFoundHelp}</p>
      </div>
      <Button asChild className="cta-primary">
        <a href="/">{t.backToHome}</a>
      </Button>
    </div>
  )
}
