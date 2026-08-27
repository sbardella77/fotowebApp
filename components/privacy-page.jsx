'use client'

import { useEffect } from 'react'
import { Shield } from 'lucide-react'
import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW } from '@/lib/analytics/events'
import { useTranslations } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'

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

function Section({ title, children }) {
  return (
    <section className="mb-10 reveal">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function Bullet({ children }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
      <span>{children}</span>
    </li>
  )
}

export function PrivacyPage({ locale = 'en' }) {
  useScrollReveal()
  const t = useTranslations('legal')

  useEffect(() => {
    trackPageView('landing', { variant: 'privacy', locale })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'privacy', locale })
  }, [locale])

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="link" />

      <section id="main-content" className="relative overflow-hidden pt-28 pb-12 sm:pt-36 sm:pb-16">
        <div className="absolute inset-0 bg-grid opacity-50" aria-hidden="true" />
        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface border border-border text-primary mx-auto shadow-card">
              <Shield className="h-6 w-6" />
            </div>
            <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t.privacyTitle}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {t.lastUpdated}
            </p>
          </div>
        </div>
      </section>

      <section className="relative border-t border-border bg-raised/30 py-12 sm:py-16">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl space-y-10">
            <div className="reveal rounded-xl border border-primary/20 bg-primary/5 p-5">
              <p className="text-sm leading-relaxed text-foreground">
                <strong>{t.productReadyDraft}</strong> {t.privacyDisclaimer}
              </p>
            </div>

            <Section title={t.whatDataWeCollect}>
              <p>{t.whatDataDesc}</p>
              <ul className="space-y-2">
                <Bullet>{t.dataEmail}</Bullet>
                <Bullet>{t.dataGuestName}</Bullet>
                <Bullet>{t.dataPhotos}</Bullet>
                <Bullet>{t.dataEventMeta}</Bullet>
                <Bullet>{t.dataIP}</Bullet>
              </ul>
            </Section>

            <Section title={t.whyProcessData}>
              <ul className="space-y-2">
                <Bullet>{t.whyProcessDesc1}</Bullet>
                <Bullet>{t.whyProcessDesc2}</Bullet>
                <Bullet>{t.whyProcessDesc3}</Bullet>
                <Bullet>{t.whyProcessDesc4}</Bullet>
                <Bullet>{t.whyProcessDesc5}</Bullet>
              </ul>
            </Section>

            <Section title={t.howStoreData}>
              <ul className="space-y-2">
                <Bullet>{t.howStoreDesc1}</Bullet>
                <Bullet>{t.howStoreDesc2}</Bullet>
                <Bullet>{t.howStoreDesc3}</Bullet>
                <Bullet>{t.howStoreDesc4}</Bullet>
              </ul>
            </Section>

            <Section title={t.whoCanAccess}>
              <ul className="space-y-2">
                <Bullet>{t.whoCanAccessDesc1}</Bullet>
                <Bullet>{t.whoCanAccessDesc2}</Bullet>
                <Bullet>{t.whoCanAccessDesc3}</Bullet>
              </ul>
            </Section>

            <Section title={t.securityMeasures}>
              <ul className="space-y-2">
                <Bullet>{t.securityDesc1}</Bullet>
                <Bullet>{t.securityDesc2}</Bullet>
                <Bullet>{t.securityDesc3}</Bullet>
                <Bullet>{t.securityDesc4}</Bullet>
              </ul>
            </Section>

            <Section title={t.dataRetention}>
              <ul className="space-y-2">
                <Bullet>{t.retentionDesc1}</Bullet>
                <Bullet>{t.retentionDesc2}</Bullet>
                <Bullet>{t.retentionDesc3}</Bullet>
                <Bullet>{t.retentionDesc4}</Bullet>
                <Bullet>{t.retentionDesc5}</Bullet>
                <Bullet>{t.retentionDesc6}</Bullet>
                <Bullet>{t.retentionDesc7}</Bullet>
              </ul>
            </Section>

            <Section title={t.yourRights}>
              <p>{t.yourRightsDesc}</p>
              <ul className="space-y-2">
                <Bullet>{t.rightAccess}</Bullet>
                <Bullet>{t.rightCorrection}</Bullet>
                <Bullet>{t.rightDeletion}</Bullet>
                <Bullet>{t.rightRestriction}</Bullet>
                <Bullet>{t.rightPortability}</Bullet>
              </ul>
            </Section>

            <Section title={t.requestDeletion}>
              <p>
                {t.requestDeletionDesc}{' '}
                <a href="mailto:hello@snaprooms.app" className="text-accent-dark underline underline-offset-4 hover:text-accent-dark/80">
                  {t.emailAddress}
                </a>.
              </p>
              <p className="mt-2">
                {t.requestDeletionConfirm}
              </p>
            </Section>

            <Section title={t.contact}>
              <p>
                {t.contactDesc}{' '}
                <a href="mailto:hello@snaprooms.app" className="text-accent-dark underline underline-offset-4 hover:text-accent-dark/80">
                  {t.emailAddress}
                </a>.
              </p>
            </Section>

            <div className="mt-12 border-t border-border pt-8 text-center">
              <a
                href={localizedPath(locale, '/')}
                className="inline-flex items-center gap-2 text-sm font-medium text-accent-dark hover:text-accent-dark/80"
              >
                {t.backToSnapRooms}
              </a>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
