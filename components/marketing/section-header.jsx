'use client'

export function SectionHeader({ label, title, description }) {
  return (
    <div className="mx-auto max-w-3xl text-center px-4">
      <span className="inline-block font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-foreground sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base sm:text-lg leading-relaxed text-muted-foreground max-w-2xl mx-auto">
          {description}
        </p>
      )}
    </div>
  )
}
