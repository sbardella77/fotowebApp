'use client'

import { useEffect } from 'react'
import {
  Scale,
  Briefcase,
  Shield,
  Lock,
  EyeOff,
  Ban,
  UserCheck,
  FileText,
  CreditCard,
  AlertTriangle,
  Globe,
  Mail,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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

function Section({ number, title, icon: Icon, children }) {
  return (
    <div className="reveal">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <h2 className="font-display text-lg font-semibold text-white">
          {number && `${number}. `}{title}
        </h2>
      </div>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  )
}

export function CommercialLicensePage() {
  useScrollReveal()
  const t = useTranslations('legal')

  useEffect(() => {
    trackPageView('landing', { variant: 'commercial_license' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'commercial_license' })
  }, [])

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
              <Briefcase className="h-6 w-6" />
            </div>
            <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t.commercialTitle}
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
          <div className="mx-auto max-w-3xl space-y-12">
            {/* Disclaimer */}
            <div className="reveal rounded-xl border border-primary/20 bg-primary/5 p-5">
              <p className="text-sm leading-relaxed text-primary/90">
                <strong>{t.productReadyDraft}</strong> {t.commercialDisclaimer}
              </p>
            </div>

            <Section number="1" title={t.permittedCommercialUse} icon={CheckCircle2}>
              <p>
                {t.permittedDesc}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t.permitted1}</li>
                <li>{t.permitted2}</li>
                <li>{t.permitted3}</li>
                <li>{t.permitted4}</li>
                <li>{t.permitted5}</li>
                <li>{t.permitted6}</li>
              </ul>
              <p>
                {t.permittedDesc2}
              </p>
            </Section>

            <Section number="2" title={t.privateVsCommercial} icon={Lock}>
              <p>
                {t.privateVsCommercialDesc1}
              </p>
              <p>
                {t.privateVsCommercialDesc2}
              </p>
              <p>
                {t.privateVsCommercialDesc3}
              </p>
            </Section>

            <Section number="3" title={t.brandingWhiteLabel} icon={EyeOff}>
              <p>
                {t.brandingDesc1}
              </p>
              <p>
                <strong>{t.brandingDesc2}</strong>
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t.brandingNot1}</li>
                <li>{t.brandingNot2}</li>
                <li>{t.brandingNot3}</li>
                <li>{t.brandingNot4}</li>
              </ul>
              <p>
                {t.brandingDesc3}
              </p>
            </Section>

            <Section number="4" title={t.prohibitedUses} icon={Ban}>
              <p>
                {t.prohibitedDesc}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t.prohibited1}</li>
                <li>{t.prohibited2}</li>
                <li>{t.prohibited3}</li>
                <li>{t.prohibited4}</li>
                <li>{t.prohibited5}</li>
                <li>{t.prohibited6}</li>
                <li>{t.prohibited7}</li>
              </ul>
              <p>
                {t.prohibitedConsequences}
              </p>
            </Section>

            <Section number="5" title={t.organizerResponsibilities} icon={UserCheck}>
              <p>
                {t.organizerDesc}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t.organizer1}</li>
                <li>{t.organizer2}</li>
                <li>{t.organizer3}</li>
                <li>{t.organizer4}</li>
                <li>{t.organizer5}</li>
                <li>{t.organizer6}</li>
              </ul>
              <p>
                {t.organizerIndemnity}
              </p>
            </Section>

            <Section number="6" title={t.contentOwnership} icon={FileText}>
              <p>
                {t.contentOwnershipDesc1}
              </p>
              <p>
                {t.contentOwnershipDesc2}
              </p>
              <p>
                {t.contentOwnershipDesc3}
              </p>
            </Section>

            <Section number="7" title={t.subscriptionBilling} icon={CreditCard}>
              <p>
                {t.billingDesc1}
              </p>
              <p>
                {t.billingDesc2}
              </p>
              <p>
                {t.billingDesc3}
              </p>
            </Section>

            <Section number="8" title={t.terminationSuspension} icon={AlertTriangle}>
              <p>
                {t.termSuspensionDesc1}
              </p>
              <p>
                {t.termSuspensionDesc2}
              </p>
              <p>
                {t.termSuspensionDesc3}
              </p>
            </Section>

            <Section number="9" title={t.liabilityDisclaimer} icon={Shield}>
              <p>
                {t.liabilityDisclaimerDesc1}
              </p>
              <p>
                {t.liabilityDisclaimerDesc2}
              </p>
              <p>
                {t.liabilityDisclaimerDesc3}
              </p>
            </Section>

            <Section number="10" title={t.governingLaw} icon={Globe}>
              <p>
                {t.governingLawDesc}
              </p>
              <p>
                {/* TODO: not in dictionary */}
                [Placeholder: Insert specific jurisdiction and arbitration details upon legal review.]
              </p>
            </Section>

            <Section number="11" title={t.commercialContact} icon={Mail}>
              <p>
                {t.commercialContactDesc}
              </p>
              <p className="text-foreground">
                <strong>{t.emailLabel}</strong>{' '}
                <a href="mailto:hello@snaprooms.app" className="text-primary hover:underline">
                  {t.emailAddress}
                </a>
              </p>
              <p>
                {t.commercialResponse}
              </p>
            </Section>

            <div className="reveal rounded-xl border border-white/[0.07] bg-[#141C2E] p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t.commercialAcceptance}{' '}
                <a href="/terms" className="text-primary hover:underline">
                  {t.termsTitle}
                </a>.
              </p>
            </div>

            <div className="reveal flex flex-col items-center gap-4 rounded-xl border border-white/[0.07] bg-[#141C2E] p-8 text-center">
              <h3 className="font-display text-lg font-semibold text-white">
                {t.readyToUse}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t.readyToUseDesc}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="glow-blue" asChild>
                  <a href="/">{t.createFreeEvent}</a>
                </Button>
                <Button variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                  <a href="/pricing">{t.viewProPlans}</a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
