'use client'

import Image from 'next/image'
import { MessageCircle, X, CheckCircle2 } from 'lucide-react'

const CHAOS_BUBBLES = [
  { tone: 'bg-rose-200/70 text-rose-900', align: 'items-start' },
  { tone: 'bg-sky-200/70 text-sky-900', align: 'items-end' },
  { tone: 'bg-amber-200/70 text-amber-900', align: 'items-start' },
]

/**
 * "Groups get messy. Photos get lost." — a generic (non-branded) messaging
 * chaos mockup on the left, the SnapRooms unified gallery on the right.
 * `t` is the `landing` translations object (problem1-3 / solution1-3Title/Desc).
 */
export function ProblemSection({ t, photos = [] }) {
  const problems = [t.problem1, t.problem2, t.problem3].filter(Boolean)
  const solutions = [
    { title: t.solution1Title, desc: t.solution1Desc },
    { title: t.solution2Title, desc: t.solution2Desc },
    { title: t.solution3Title, desc: t.solution3Desc },
  ].filter((s) => s.title)

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      {/* Chaos */}
      <div className="reveal rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-2.5">
          {CHAOS_BUBBLES.map((bubble, i) => (
            <div key={i} className={`flex ${bubble.align}`}>
              <div className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium ${bubble.tone} max-w-[75%]`}>
                <MessageCircle className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                <span className="h-2 flex-1 rounded-full bg-current opacity-25" style={{ minWidth: `${40 + i * 20}px` }} />
              </div>
            </div>
          ))}
        </div>
        <ul className="mt-6 space-y-3 border-t border-border pt-6">
          {problems.map((problem, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <X className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/70" aria-hidden="true" />
              <span>{problem}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Resolved: SnapRooms gallery */}
      <div className="reveal rounded-2xl border border-border bg-[hsl(var(--bg-elevated))] p-6 sm:p-8" style={{ transitionDelay: '100ms' }}>
        <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
          {(photos.length ? photos : Array.from({ length: 4 })).slice(0, 4).map((photo, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-lg bg-secondary border border-border">
              {photo ? (
                <Image src={photo.src} alt="" fill sizes="120px" className="object-cover" />
              ) : null}
            </div>
          ))}
        </div>
        <ul className="mt-6 space-y-3 border-t border-border pt-6">
          {solutions.map((solution, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-accent-dark" aria-hidden="true" />
              <span>
                <span className="font-semibold text-foreground">{solution.title}.</span>{' '}
                <span className="text-muted-foreground">{solution.desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
