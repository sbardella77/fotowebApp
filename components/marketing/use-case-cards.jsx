'use client'

import { CheckCircle2 } from 'lucide-react'

export function UseCaseCards({ cases }) {
  return (
    <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cases.map((item, i) => (
        <div
          key={item.title}
          className="reveal group relative overflow-hidden rounded-xl border border-[#DDD7CA] bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#D1CDBF] hover:shadow-elevated"
          style={{ transitionDelay: `${i * 80}ms` }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#F1EDE3] border border-[#DDD7CA]">
            <item.icon className={`h-6 w-6 ${item.color}`} />
          </div>
          <h3 className="mt-5 font-display text-lg font-bold tracking-tight text-[#222222]">
            {item.title}
          </h3>
          <p className="mt-2 text-sm text-[#5B5B5B] leading-relaxed">
            {item.desc}
          </p>
          {item.bullets && (
            <ul className="mt-4 space-y-2.5">
              {item.bullets.map((bullet) => (
                <li key={bullet} className="flex items-center gap-2 text-sm text-[#5B5B5B]">
                  <CheckCircle2 className="h-4 w-4 text-[#8A9A1B] shrink-0" />
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
