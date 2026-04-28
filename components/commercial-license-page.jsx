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
              Commercial License & Professional Terms
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
          <div className="mx-auto max-w-3xl space-y-12">
            {/* Disclaimer */}
            <div className="reveal rounded-xl border border-primary/20 bg-primary/5 p-5">
              <p className="text-sm leading-relaxed text-primary/90">
                <strong>Product-ready draft.</strong> This Commercial License is a
                product-ready draft intended for professional users of the SnapRooms
                platform. It is provided as-is and does not constitute legal advice.
                We recommend consulting a qualified attorney to review these terms
                before relying on them for enforcement or compliance purposes.
              </p>
            </div>

            <Section number="1" title="Permitted Commercial Use" icon={CheckCircle2}>
              <p>
                As a SnapRooms subscriber, you are permitted to use the platform as part
                of your professional services, including but not limited to:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Wedding photography packages and client deliverables</li>
                <li>Event planning and coordination services</li>
                <li>Venue amenity offerings and guest experience programs</li>
                <li>Agency client work and campaign execution</li>
                <li>Corporate internal events and team activities</li>
                <li>Professional organizer services and private functions</li>
              </ul>
              <p>
                Commercial use is permitted under both Free and Pro subscriptions,
                subject to the limitations outlined in these terms. Pro subscribers
                receive expanded capabilities including unlimited rooms, permanent
                galleries, and bulk downloads.
              </p>
            </Section>

            <Section number="2" title="Private vs Commercial Distinction" icon={Lock}>
              <p>
                <strong>Private use</strong> refers to personal, non-commercial events
                where you are the host and primary beneficiary (e.g., your own wedding,
                family birthday, personal party).
              </p>
              <p>
                <strong>Commercial use</strong> refers to any use where SnapRooms is
                incorporated into a service offering for which you or your organization
                receives compensation, or where you act on behalf of a paying client.
              </p>
              <p>
                Both private and commercial users must comply with these terms and the
                general Terms of Service. Commercial users are additionally responsible
                for ensuring their clients understand how their data and photos will be
                handled.
              </p>
            </Section>

            <Section number="3" title="Branding & White-Label Limitations" icon={EyeOff}>
              <p>
                SnapRooms branding may appear within the guest upload experience,
                gallery views, and QR code interfaces. Pro subscribers may request
                reduced branding visibility, but complete white-labeling is not
                available under standard plans.
              </p>
              <p>
                <strong>What is not permitted without a written agreement:</strong>
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Removing or replacing SnapRooms branding in a way that suggests the platform is your own product</li>
                <li>Reselling SnapRooms access as a standalone service under your own brand</li>
                <li>Creating a competing photo-collection product using SnapRooms infrastructure</li>
                <li>Embedding SnapRooms in a way that obscures its origin to end users</li>
              </ul>
              <p>
                Custom white-label and API access may be available under a separate
                enterprise agreement. Contact hello@snaprooms.app to inquire.
              </p>
            </Section>

            <Section number="4" title="Prohibited Uses" icon={Ban}>
              <p>
                Regardless of subscription tier, the following uses are strictly prohibited:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Uploading illegal, harmful, obscene, or infringing content</li>
                <li>Using SnapRooms to harvest data or scrape user information</li>
                <li>Attempting to reverse-engineer, hack, or compromise the platform</li>
                <li>Creating rooms for fraudulent, deceptive, or malicious purposes</li>
                <li>Distributing malware, spam, or unsolicited communications through the platform</li>
                <li>Using automated scripts or bots to create rooms or upload photos at scale</li>
                <li>Reselling room access or photo collections in violation of applicable law</li>
              </ul>
              <p>
                Violation of these prohibitions may result in immediate account
                suspension, termination, and potential legal action.
              </p>
            </Section>

            <Section number="5" title="Organizer Responsibilities" icon={UserCheck}>
              <p>
                As the room creator and commercial user, you are responsible for:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Obtaining consent from guests and clients for photo collection</li>
                <li>Complying with applicable privacy laws (GDPR, CCPA, etc.) in your jurisdiction</li>
                <li>Ensuring you have the right to share any content uploaded to your rooms</li>
                <li>Maintaining the confidentiality of your room links and QR codes</li>
                <li>Removing content promptly upon valid takedown requests</li>
                <li>Informing clients that SnapRooms is a third-party service provider</li>
              </ul>
              <p>
                You agree to indemnify and hold harmless SnapRooms from any claims
                arising from your failure to meet these responsibilities.
              </p>
            </Section>

            <Section number="6" title="Content Ownership Boundaries" icon={FileText}>
              <p>
                You and your clients retain ownership of all photos and content uploaded
                to your rooms. SnapRooms does not claim ownership of your content.
              </p>
              <p>
                By using the Service, you grant SnapRooms a limited, non-exclusive,
                royalty-free license to store, transmit, and display your content solely
                for the purpose of operating the platform. This license terminates when
                you delete your content or close your account.
              </p>
              <p>
                We do not sell your photos, use them for advertising, or train machine
                learning models on them without your explicit consent.
              </p>
            </Section>

            <Section number="7" title="Subscription & Billing" icon={CreditCard}>
              <p>
                Commercial users may subscribe to Free or Pro plans. Pro plans are billed
                in advance on a recurring basis through Stripe. You are responsible for
                maintaining accurate billing information and ensuring timely payment.
              </p>
              <p>
                Cancellation can be initiated at any time through your dashboard.
                Cancellations take effect at the end of the current billing cycle.
                No prorated refunds are guaranteed, though we may issue them at our
                discretion.
              </p>
              <p>
                We reserve the right to change pricing with reasonable notice. Existing
                subscribers will be notified in advance of any pricing changes.
              </p>
            </Section>

            <Section number="8" title="Termination & Suspension" icon={AlertTriangle}>
              <p>
                We reserve the right to suspend or terminate your account without notice
                if you violate these terms, engage in fraudulent activity, or create risk
                or legal exposure for SnapRooms or other users.
              </p>
              <p>
                Upon termination, your rooms and associated content may be retained for
                a limited period to allow for data recovery or legal compliance, after
                which they may be permanently deleted. We are not obligated to retain
                your content beyond what is necessary for legal or operational purposes.
              </p>
              <p>
                You may export your data at any time prior to termination using the
                bulk download feature available in your dashboard.
              </p>
            </Section>

            <Section number="9" title="Liability Disclaimer" icon={Shield}>
              <p>
                SnapRooms is provided &ldquo;as is&rdquo; without warranties of any kind,
                express or implied. We do not guarantee uninterrupted service, data
                integrity, or fitness for a particular commercial purpose.
              </p>
              <p>
                To the maximum extent permitted by law, SnapRooms shall not be liable
                for any indirect, incidental, special, consequential, or punitive damages
                arising from your commercial use of the platform, including lost profits,
                lost data, or reputational harm.
              </p>
              <p>
                Our total liability for any claim shall not exceed the total amount you
                have paid to SnapRooms in the twelve (12) months preceding the claim, or
                one hundred US dollars ($100) if no payments have been made.
              </p>
            </Section>

            <Section number="10" title="Governing Law" icon={Globe}>
              <p>
                These terms shall be governed by and construed in accordance with the laws
                of the jurisdiction in which SnapRooms operates, without regard to conflict
                of law principles. Any dispute shall first be addressed through good-faith
                negotiation. If unresolved, disputes shall be submitted to binding
                arbitration or the competent courts of that jurisdiction.
              </p>
              <p>
                [Placeholder: Insert specific jurisdiction and arbitration details upon
                legal review.]
              </p>
            </Section>

            <Section number="11" title="Contact" icon={Mail}>
              <p>
                For questions about commercial licensing, custom terms, enterprise
                agreements, or white-label partnerships, please contact us:
              </p>
              <p className="text-foreground">
                <strong>Email:</strong>{' '}
                <a href="mailto:hello@snaprooms.app" className="text-primary hover:underline">
                  hello@snaprooms.app
                </a>
              </p>
              <p>
                We typically respond to commercial inquiries within one business day.
              </p>
            </Section>

            <div className="reveal rounded-xl border border-white/[0.07] bg-[#141C2E] p-6 text-center">
              <p className="text-sm text-muted-foreground">
                By using SnapRooms for commercial purposes, you acknowledge that you have
                read, understood, and agree to be bound by these Commercial License terms
                in addition to our general{' '}
                <a href="/terms" className="text-primary hover:underline">
                  Terms of Service
                </a>.
              </p>
            </div>

            <div className="reveal flex flex-col items-center gap-4 rounded-xl border border-white/[0.07] bg-[#141C2E] p-8 text-center">
              <h3 className="font-display text-lg font-semibold text-white">
                Ready to use SnapRooms professionally?
              </h3>
              <p className="text-sm text-muted-foreground">
                Start with a free room or upgrade to Pro for unlimited client projects.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="glow-blue" asChild>
                  <a href="/">Create free room</a>
                </Button>
                <Button variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                  <a href="/pricing">View Pro plans</a>
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
