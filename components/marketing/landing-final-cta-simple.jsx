'use client'

import { Button } from '@/components/ui/button'

/**
 * The "two buttons, no form" final CTA shared by corporate, birthday,
 * private-party, photographers and planners. Wedding keeps its own
 * form-based final CTA (it collects the event name/email inline) and is
 * not wired to this one.
 *
 * `helperText` is optional — corporate/birthday/private-party render a
 * mono microcopy line underneath, photographers/planners don't.
 */
export function LandingFinalCtaSimple({
  title,
  desc,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  helperText,
  sectionClassName = 'relative pb-16 sm:pb-24',
}) {
  return (
    <section className={sectionClassName}>
      <div className="container px-4">
        <div className="mx-auto max-w-2xl text-center reveal">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {desc}
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="cta-primary" asChild>
              <a href={primaryHref}>{primaryLabel}</a>
            </Button>
            <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-white/[0.03]" asChild>
              <a href={secondaryHref}>{secondaryLabel}</a>
            </Button>
          </div>
          {helperText && (
            <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
