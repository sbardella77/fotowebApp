'use client'

export function SectionHeader({ label, title, description, align = 'center' }) {
  const alignClass = align === 'center' ? 'text-center' : 'text-left'

  return (
    <div className={`${alignClass} max-w-2xl mx-auto`}>
      {label && (
        <span className="inline-block font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-primary mb-3">
          {label}
        </span>
      )}
      {title && (
        <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
      )}
      {description && (
        <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}
    </div>
  )
}
