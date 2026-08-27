'use client'

import Image from 'next/image'
import { ArrowRight } from 'lucide-react'

/**
 * Photography-backed use-case tiles that link directly to the real
 * segment/vertical pages (localizedPath already applied by the caller).
 * Each item: { href, icon, title, desc, photoSrc }.
 */
export function UseCasePreview({ items }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
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
            <h3 className="mt-3 font-display text-base font-bold tracking-tight text-white">
              {item.title}
            </h3>
            {item.desc && (
              <p className="mt-1 text-xs text-white/80 leading-relaxed line-clamp-2">
                {item.desc}
              </p>
            )}
            <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white">
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </div>
        </a>
      ))}
    </div>
  )
}
