'use client'

import { useEffect } from 'react'
import { Scale, FileText, Shield, Mail } from 'lucide-react'
import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW } from '@/lib/analytics/events'

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
              Terms of Service
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Last updated: April 2026
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
                <strong>Product-ready draft.</strong> These Terms of Service are a
                product-ready draft intended to govern use of the SnapRooms platform.
                They are provided as-is and do not constitute legal advice. We recommend
                consulting a qualified attorney to review these terms before relying on
                them for enforcement or compliance purposes.
              </p>
            </div>

            <Section number="1" title="Acceptance of Terms">
              <p>
                By accessing or using SnapRooms (&ldquo;the Service&rdquo;), you agree
                to be bound by these Terms of Service. If you do not agree to these
                terms, you may not use the Service. These terms apply to all visitors,
                users, event hosts, and others who access or use the Service.
              </p>
              <p>
                We may update these terms from time to time. Continued use of the Service
                after changes constitutes acceptance of the revised terms. Material changes
                will be communicated via email or a prominent notice on the platform.
              </p>
            </Section>

            <Section number="2" title="Service Description">
              <p>
                SnapRooms is a web-based platform that allows event hosts to create private
                photo rooms, generate QR codes and shareable links, and collect photos
                from guests. Guests may upload photos without creating an account. The
                Service includes tools for photo moderation, gallery management, and
                bulk download.
              </p>
              <p>
                We do not guarantee uninterrupted access to the Service. Maintenance,
                updates, or circumstances beyond our control may result in temporary
                downtime. We reserve the right to modify, suspend, or discontinue any
                part of the Service at any time.
              </p>
            </Section>

            <Section number="3" title="User Accounts">
              <p>
                To create and manage photo rooms, you must provide a valid email address.
                You are responsible for maintaining the confidentiality of your account
                credentials and for all activity that occurs under your account. You must
                notify us immediately of any unauthorized use.
              </p>
              <p>
                You may not use the Service to:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Upload illegal, harmful, threatening, defamatory, or obscene content</li>
                <li>Infringe on the intellectual property rights of others</li>
                <li>Distribute malware, spam, or unsolicited communications</li>
                <li>Attempt to gain unauthorized access to the Service or its infrastructure</li>
                <li>Use the Service in violation of any applicable law or regulation</li>
              </ul>
            </Section>

            <Section number="4" title="Content & Photos">
              <p>
                You retain ownership of all photos and content you or your guests upload
                to SnapRooms. By uploading content, you grant us a limited, non-exclusive,
                royalty-free license to store, display, and transmit that content solely
                for the purpose of operating the Service.
              </p>
              <p>
                We do not claim ownership of your content. We do not sell your photos or
                use them for advertising without your explicit consent. You are
                responsible for ensuring you have the right to share any content uploaded
                to your rooms.
              </p>
              <p>
                We reserve the right to remove content that violates these terms or that
                we reasonably believe to be unlawful, without prior notice.
              </p>
            </Section>

            <Section number="5" title="Intellectual Property">
              <p>
                The SnapRooms name, logo, software, design, and all related intellectual
                property are owned by us and protected by applicable copyright, trademark,
                and other laws. You may not copy, modify, distribute, or create derivative
                works from our intellectual property without our prior written consent.
              </p>
              <p>
                Feedback you provide about the Service may be used by us without
                restriction or compensation.
              </p>
            </Section>

            <Section number="6" title="Commercial Use & Private License">
              <p>
                <strong>Personal and professional use.</strong> You may use SnapRooms for
                both personal events (weddings, parties, gatherings) and as part of your
                professional services (wedding photography, event planning, venue
                management). No additional commercial license is required for standard
                use of the platform as intended.
              </p>
              <p>
                <strong>What is permitted.</strong> As a Pro subscriber, you may create
                unlimited rooms on behalf of clients, share room access with clients and
                guests, download and deliver photo collections, and include SnapRooms as
                part of your paid service packages.
              </p>
              <p>
                <strong>What is not permitted without written agreement.</strong> You may
                not white-label or resell the SnapRooms platform itself, create a
                competing service using our infrastructure, scrape or systematically
                collect data from the Service, or use our trademarks in a way that
                suggests endorsement or partnership without written permission.
              </p>
              <p>
                <strong>Custom terms.</strong> Agencies, venues, and businesses with
                unique requirements (such as white-labeling, API access, or volume
                commitments) may request a separate commercial agreement. Contact us at
                hello@snaprooms.app to discuss custom licensing.
              </p>
            </Section>

            <Section number="7" title="Subscriptions & Payments">
              <p>
                SnapRooms offers a free tier and a paid Pro subscription. Pro features
                are billed in advance on a recurring basis. You may cancel your
                subscription at any time through your dashboard. Cancellation takes effect
                at the end of the current billing period.
              </p>
              <p>
                We use Stripe for payment processing. We do not store your full payment
                card details. All transactions are subject to Stripe&apos;s terms and
                conditions.
              </p>
              <p>
                We reserve the right to change pricing with reasonable notice. Existing
                subscribers will be notified before any price change affects their
                subscription.
              </p>
            </Section>

            <Section number="8" title="Termination">
              <p>
                You may stop using the Service and delete your account at any time. We
                reserve the right to suspend or terminate your access if you violate these
                terms, engage in fraudulent activity, or create risk or legal exposure for
                us or other users.
              </p>
              <p>
                Upon termination, your rooms and associated photos may be retained for a
                limited period to allow for data recovery, after which they may be
                permanently deleted. We are not obligated to retain your content beyond
                what is necessary for legal or operational purposes.
              </p>
            </Section>

            <Section number="9" title="Limitation of Liability">
              <p>
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;
                without warranties of any kind, either express or implied, including but
                not limited to warranties of merchantability, fitness for a particular
                purpose, or non-infringement.
              </p>
              <p>
                To the maximum extent permitted by applicable law, we shall not be liable
                for any indirect, incidental, special, consequential, or punitive damages,
                including loss of profits, data, or goodwill, arising out of or in
                connection with your use of the Service.
              </p>
              <p>
                Our total liability for any claim arising from or relating to these terms
                or the Service shall not exceed the amount you paid us in the twelve (12)
                months preceding the claim, or one hundred US dollars ($100) if you have
                not made any payments.
              </p>
            </Section>

            <Section number="10" title="Dispute Resolution">
              <p>
                These terms shall be governed by and construed in accordance with the laws
                of the jurisdiction in which SnapRooms operates, without regard to conflict
                of law principles. Any dispute arising from these terms shall first be
                addressed through good-faith negotiation. If unresolved, disputes shall be
                submitted to binding arbitration or the competent courts of that
                jurisdiction, as determined by us.
              </p>
            </Section>

            <Section number="11" title="Changes to These Terms">
              <p>
                We may revise these terms periodically. The most current version will
                always be available at snaprooms.app/terms. We will notify registered users
                of material changes via email. Your continued use of the Service after
                changes take effect constitutes acceptance.
              </p>
            </Section>

            <Section number="12" title="Contact">
              <p>
                If you have questions about these terms, our commercial licensing options,
                or anything else, please contact us:
              </p>
              <p className="text-foreground">
                <strong>Email:</strong>{' '}
                <a href="mailto:hello@snaprooms.app" className="text-primary hover:underline">
                  hello@snaprooms.app
                </a>
              </p>
            </Section>

            <div className="reveal rounded-xl border border-white/[0.07] bg-[#141C2E] p-6 text-center">
              <p className="text-sm text-muted-foreground">
                By using SnapRooms, you acknowledge that you have read, understood, and
                agree to be bound by these Terms of Service.
              </p>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
