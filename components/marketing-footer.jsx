'use client'

import { Camera } from 'lucide-react'
import { useTranslations } from '@/components/i18n-provider'
import { InstallCta } from '@/components/install-cta'

export function MarketingFooter() {
  const t = useTranslations('footer')

  return (
    <>
      <div className="container mx-auto max-w-3xl px-4 pb-6">
        <InstallCta mode="landing" />
      </div>
      <footer className="border-t border-white/[0.07] bg-[#0D1220] py-10">
      <div className="container px-4">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Camera className="h-3 w-3" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </a>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="/pricing" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              {t.pricing}
            </a>
            <a href="/for-wedding-photographers" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              {t.forPhotographers}
            </a>
            <a href="/for-event-planners" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              {t.forPlanners}
            </a>
            <a href="/privacy" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              {t.privacy}
            </a>
            <a href="/terms" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              {t.terms}
            </a>
            <a href="/commercial-license" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              {t.commercialLicense}
            </a>
            <a href="/dashboard/login" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              {t.organizerSignIn}
            </a>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs font-light text-muted-foreground/60">
            {t.tagline}
          </p>
        </div>
      </div>
    </footer>
  </>
  )
}
