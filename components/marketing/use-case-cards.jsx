'use client'

import { CheckCircle2 } from 'lucide-react'

export function UseCaseCards({ cases }) {
  return (
    <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cases.map((item, i) => (
        <article
          key={item.title}
          className="reveal group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[hsl(var(--border-visible))] hover:shadow-elevated"
          style={{ transitionDelay: `${i * 80}ms` }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary border border-border">
            <item.icon
              className={`h-6 w-6 ${item.color}`}
              aria-hidden="true"
            />
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
                <li
                  key={bullet}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <CheckCircle2
                    className="h-4 w-4 text-accent-dark shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  )
}
