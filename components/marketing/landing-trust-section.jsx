'use client'

import { Shield } from 'lucide-react'

/**
 * Centered "Trust / Privacy" block (icon + title + desc, then a 3-col grid
 * of short privacy features) shared by corporate, birthday and
 * private-party landing pages. Wedding and photographers use a different
 * two-column layout and are not wired to this one.
 */
export function LandingTrustSection({ title, desc, items }) {
  return (
    <section className="border-t border-border bg-card py-20 sm:py-28">
      <div className="container px-4">
        <div className="mx-auto max-w-3xl text-center reveal">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary border border-border text-primary shadow-subtle">
            <Shield className="h-6 w-6" />
          </div>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {desc}
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-3">
          {items.map((item, i) => (
            <div
              key={item.title}
              className="reveal min-w-0 rounded-2xl border border-border bg-surface p-5 text-center shadow-elevated"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <h3 className="font-display text-sm font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-xs text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
