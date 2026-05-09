'use client'

import { CheckCircle2, Shield, Zap, Users } from 'lucide-react'

export function TrustStrip({ items = null }) {
  const defaultItems = [
    { icon: Shield, text: 'No app required' },
    { icon: Zap, text: 'Instant setup' },
    { icon: Users, text: 'Unlimited guests' },
    { icon: CheckCircle2, text: 'Free forever' },
  ]

  const displayItems = items || defaultItems

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
      {displayItems.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs text-[#7A746B]">
          <item.icon className="h-3.5 w-3.5 text-[#8A9A1B]" />
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  )
}
