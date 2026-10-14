'use client'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { SectionHeader } from '@/components/marketing/section-header'

/**
 * "card"-style FAQ accordion (rounded bg-surface items) shared by corporate,
 * birthday and private-party. Wedding uses a different bordered-list style
 * and a 7th question, and is not wired to this one.
 */
export function LandingFaqSection({ title, questions, sectionClassName = 'relative py-24 sm:py-32' }) {
  return (
    <section className={sectionClassName}>
      <div className="container px-4">
        <div className="mx-auto max-w-3xl">
          <div className="text-center reveal">
            <SectionHeader title={title} />
          </div>

          <div className="mt-10 reveal">
            <Accordion type="single" collapsible className="space-y-3">
              {questions.map((faq, i) => (
                <AccordionItem
                  key={i}
                  value={`item-${i}`}
                  className="rounded-2xl border border-border bg-surface px-5 shadow-elevated"
                >
                  <AccordionTrigger className="text-left text-sm font-semibold text-foreground hover:no-underline">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </section>
  )
}
