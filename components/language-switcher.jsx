'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { getMarketingLanguageLinks } from '@/lib/i18n/marketing-language-links'
import { Globe, Check } from 'lucide-react'
import { useLocale, useSetLocale } from '@/components/i18n-provider'
import { LOCALES, LOCALE_LABELS } from '@/lib/i18n/config'
import { trackEvent } from '@/lib/analytics/track-client'
import { EVENT_LANGUAGE_SWITCHED } from '@/lib/analytics/events'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

export function LanguageSwitcher({ className = '' }) {
  const locale = useLocale()
  const languageLinks = getMarketingLanguageLinks(usePathname())
  const setLocale = useSetLocale()
  const [open, setOpen] = useState(false)

  const handleSelect = (newLocale) => {
    if (newLocale === locale) {
      setOpen(false)
      return
    }
    trackEvent(EVENT_LANGUAGE_SWITCHED, {
      from_language: locale,
      to_language: newLocale,
    })
    setLocale(newLocale)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md h-9 px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="Change language"
        >
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{locale.toUpperCase()}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-44 p-0 py-1 rounded-xl border border-border bg-popover shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div role="listbox" aria-label="Select language">
          {LOCALES.map((l) => (
            <LanguageOption
              key={l}
              href={languageLinks?.[l]}
              hrefLang={l}
              type="button"
              role="option"
              aria-selected={l === locale}
              onClick={() => {
                if (languageLinks) {
                  if (l !== locale) trackEvent(EVENT_LANGUAGE_SWITCHED, { from_language: locale, to_language: l })
                  setOpen(false)
                } else {
                  handleSelect(l)
                }
              }}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-accent hover:text-accent-foreground ${
                l === locale
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-foreground'
              }`}
            >
              <span>{LOCALE_LABELS[l]}</span>
              {l === locale && (
                <Check className="h-4 w-4 text-accent-dark shrink-0 ml-2" />
              )}
            </LanguageOption>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LanguageOption({ href, hrefLang, type, children, ...props }) {
  return href ? (
    <a href={href} hrefLang={hrefLang} {...props}>{children}</a>
  ) : (
    <button type={type} {...props}>{children}</button>
  )
}
