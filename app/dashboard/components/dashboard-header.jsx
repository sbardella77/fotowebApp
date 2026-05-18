'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DashboardHeader({ title, description, onCreateClick, createLabel }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm font-light text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" className="cta-primary shrink-0" onClick={onCreateClick}>
        <Plus className="mr-2 h-4 w-4" />
        {createLabel}
      </Button>
    </div>
  )
}
