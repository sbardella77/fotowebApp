'use client'

import { CheckCircle2 } from 'lucide-react'

export function UseCaseCards({ cases }) {
  return (
    <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cases.map((item, i) => (
        <div
          key={item.title}
          className="reveal group relative overflow-hidden rounded-xl border border-white/[0.08] bg-raised p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.12] hover:shadow-elevated"
          style={{ transitionDelay: `${i * 80}ms` }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised border border-white/[0.08]">
            <item.icon className={`h-6 w-6 ${item.color}`} />
          </div>
          <h3 className="mt-5 font-display text-lg font-bold tracking-tight text-foreground">
            {item.title}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {item.desc}
          </p>
          {item.bullets && (
            <ul className="mt-4 space-y-2.5">
              {item.bullets.map((bullet) => (
                <li key={bullet} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
