'use client'

import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { SectionHeader } from '@/components/marketing/section-header'

/**
 * "Other ways to use SnapRooms" cross-link cards, shared by every landing
 * variant that renders them as plain photo cards (wedding, corporate,
 * birthday, private-party, photographers). Planners uses the richer
 * UseCasePreview component instead and is not wired to this one.
 *
 * `items[].cta` is optional — when omitted, the trailing label is blank and
 * only the arrow renders (matches the photographers variant exactly).
 */
export function LandingCrossLinkSection({
  label,
  title,
  items,
  sectionClassName = 'border-t border-border py-20 sm:py-28',
}) {
  return (
    <section className={sectionClassName}>
      <div className="container px-4">
        <div className="reveal"><SectionHeader label={label} title={title} /></div>
        <div className="mx-auto mt-12 grid max-w-2xl gap-4 sm:grid-cols-2">
          {items.map((item, i) => (
            <a
              key={item.href}
              href={item.href}
              className="reveal group relative flex min-h-[220px] flex-col justify-end overflow-hidden rounded-2xl border border-border shadow-subtle transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <Image
                src={item.photoSrc}
                alt=""
                fill
                sizes="(min-width: 640px) 50vw, 100vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div
                className="absolute inset-0"
                aria-hidden="true"
                style={{ background: 'linear-gradient(180deg, transparent 30%, hsl(0 0% 8% / 0.75) 100%)' }}
              />
              <div className="relative p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                  <item.icon className="h-4.5 w-4.5 text-white" aria-hidden="true" />
                </div>
                <h3 className="mt-3 font-display text-base font-bold tracking-tight text-white">{item.title}</h3>
                {item.desc && <p className="mt-1 text-xs text-white/80 leading-relaxed line-clamp-2">{item.desc}</p>}
                <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                  {item.cta}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
