'use client'

import { Loader2, Sparkles, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function ProfessionalUpgradeModal({
  open,
  onClose,
  onStartCheckout,
  preselectedBillingInterval = null,
  t,
  checkoutBusy,
}) {
  const isAnnualPreferred = preselectedBillingInterval === 'annual'

  const plans = [
    {
      id: 'monthly',
      label: t.professionalMonthlyLabel,
      price: t.professionalMonthlyPrice || '€79',
      interval: t.perMonth || '/ month',
      description: t.professionalMonthlyDescription,
      cta: t.startMonthly,
      variant: 'outline',
      highlight: !isAnnualPreferred,
    },
    {
      id: 'annual',
      label: t.professionalAnnualLabel,
      price: t.professionalAnnualPrice || '€790',
      interval: t.perYear || '/ year',
      description: t.professionalAnnualDescription,
      cta: t.startYearly,
      variant: 'primary',
      highlight: isAnnualPreferred,
      badge: t.twoMonthsFree,
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl border-border bg-surface p-0 sm:max-w-[540px] overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent-dark" />
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">
              {t.premium}
            </span>
          </div>
          <DialogTitle className="mt-2 font-display text-xl font-bold text-foreground">
            {t.upgradeToProfessional}
          </DialogTitle>
          <DialogDescription className="text-sm font-light text-muted-foreground">
            {t.chooseProfessionalBilling}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-6 pb-6 sm:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-xl border p-4 transition-colors ${
                plan.highlight
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-secondary'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-2.5 right-3">
                  <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                    {plan.badge}
                  </span>
                </div>
              )}
              <p className="text-sm font-semibold text-foreground">{plan.label}</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-2xl font-bold text-foreground">{plan.price}</span>
                <span className="text-xs text-muted-foreground">{plan.interval}</span>
              </div>
              <p className="mt-2 flex-1 text-xs font-light leading-relaxed text-muted-foreground">
                {plan.description}
              </p>
              <ul className="mt-3 space-y-1.5">
                {(plan.id === 'monthly'
                  ? [t.flexibleMonthlyCancellation]
                  : [t.twoMonthsFree, t.save158]
                ).map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent-dark" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                className={`mt-4 w-full ${plan.variant === 'primary' ? 'cta-primary' : 'border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground'}`}
                disabled={checkoutBusy}
                onClick={() => onStartCheckout(plan.id)}
              >
                {checkoutBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  plan.cta
                )}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
