'use client'

export function SectionHeader({ label, title, description }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#7A746B]">
        {label}
      </span>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-[#222222] sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-relaxed text-[#5B5B5B]">
          {description}
        </p>
      )}
    </div>
  )
}
