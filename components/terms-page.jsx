'use client'

import { useEffect } from 'react'
import { Scale, FileText, Shield, Mail } from 'lucide-react'
import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW } from '@/lib/analytics/events'
import { useTranslations } from '@/components/i18n-provider'

function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.05, rootMargin: '0px 0px -40px 0px' }
    )
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

function Section({ number, title, children }) {
  return (
    <div className="reveal">
      <h2 className="font-display text-lg font-semibold text-white">
        {number}. {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  )
}

export function TermsPage({ locale = 'en' }) {
  useScrollReveal()
  const t = useTranslations('legal')

  useEffect(() => {
    trackPageView('landing', { variant: 'terms', locale })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'terms', locale })
  }, [locale])

  return (
    <div className="dark relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="link" />

      {/* Hero */}
      <section className="relative overflow-hidden pt-28 pb-12 sm:pt-36 sm:pb-16">
        <div className="absolute inset-0 bg-grid opacity-50" aria-hidden="true" />
        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary mx-auto shadow-card">
              <Scale className="h-6 w-6" />
            </div>
            <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t.termsTitle}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {t.lastUpdated}
            </p>
          </div>
        </div>
      </section>

      {/* Document */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/30 py-12 sm:py-16">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl space-y-10">
            {/* Disclaimer */}
            <div className="reveal rounded-xl border border-primary/20 bg-primary/5 p-5">
              <p className="text-sm leading-relaxed text-primary/90">
                <strong>{t.productReadyDraft}</strong> {t.termsDisclaimer}
              </p>
            </div>

            <Section number="1" title={t.acceptanceOfTerms}>
              <p>
                {t.acceptanceDesc1}
              </p>
              <p>
                {t.acceptanceDesc2}
              </p>
            </Section>

            <Section number="2" title={t.serviceDescription}>
              <p>
                {t.serviceDesc1}
              </p>
              <p>
                {t.serviceDesc2}
              </p>
            </Section>

            <Section number="3" title={t.userAccounts}>
              <p>
                {t.userAccountsDesc1}
              </p>
              <p>
                {t.userAccountsDesc2}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t.prohibitedUse1}</li>
                <li>{t.prohibitedUse2}</li>
                <li>{t.prohibitedUse3}</li>
                <li>{t.prohibitedUse4}</li>
                <li>{t.prohibitedUse5}</li>
              </ul>
            </Section>

            <Section number="4" title={t.contentPhotos}>
              <p>
                {t.contentDesc1}
              </p>
              <p>
                {t.contentDesc2}
              </p>
              <p>
                {t.contentDesc3}
              </p>
            </Section>

            <Section number="5" title={t.intellectualProperty}>
              <p>
                {t.ipDesc1}
              </p>
              <p>
                {t.ipDesc2}
              </p>
            </Section>

            <Section number="6" title={t.commercialUse}>
              <p>
                {t.commercialUseDesc1}
              </p>
              <p>
                {t.commercialUseDesc2}
              </p>
              <p>
                {t.commercialUseDesc3}
              </p>
              <p>
                {t.commercialUseDesc4}
              </p>
            </Section>

            <Section number="7" title={t.subscriptionsPayments}>
              <p>
                {t.subscriptionsDesc1}
              </p>
              <p>
                {t.subscriptionsDesc2}
              </p>
              <p>
                {t.subscriptionsDesc3}
              </p>
            </Section>

            <Section number="8" title={t.termination}>
              <p>
                {t.terminationDesc1}
              </p>
              <p>
                {t.terminationDesc2}
              </p>
            </Section>

            <Section number="9" title={t.limitationOfLiability}>
              <p>
                {t.liabilityDesc1}
              </p>
              <p>
                {t.liabilityDesc2}
              </p>
              <p>
                {t.liabilityDesc3}
              </p>
            </Section>

            <Section number="10" title={t.disputeResolution}>
              <p>
                {t.disputeDesc}
              </p>
            </Section>

            <Section number="11" title={t.changesToTerms}>
              <p>
                {t.changesDesc}
              </p>
            </Section>

            <Section number="12" title={t.termsContact}>
              <p>
                {t.termsContactDesc}
              </p>
              <p className="text-foreground">
                <strong>{t.emailLabel}</strong>{' '}
                <a href="mailto:hello@snaprooms.app" className="text-primary hover:underline">
                  {t.emailAddress}
                </a>
              </p>
            </Section>

            <div className="reveal rounded-xl border border-white/[0.07] bg-[#141C2E] p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t.termsAcceptance}
              </p>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
