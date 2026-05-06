'use client'

import { Sparkles, Share2, ImagePlus } from 'lucide-react'

export function HowItWorks({ steps, t }) {
  const defaultSteps = [
    { num: '01', icon: Sparkles, title: t?.step1Title || 'Create your event', desc: t?.step1Desc || 'Name your event and get a unique link and QR code instantly.' },
    { num: '02', icon: Share2, title: t?.step2Title || 'Share with guests', desc: t?.step2Desc || 'Send the link or display the QR code at your venue.' },
    { num: '03', icon: ImagePlus, title: t?.step3Title || 'Collect photos', desc: t?.step3Desc || 'Watch your gallery fill up as guests upload.' },
  ]

  const displaySteps = steps || defaultSteps

  return (
    <div className="grid gap-8 sm:grid-cols-3">
      {displaySteps.map((step, i) => (
        <div
          key={step.num}
          className="reveal relative flex flex-col items-center text-center group"
          style={{ transitionDelay: `${i * 100}ms` }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface border border-white/[0.08] text-primary shadow-subtle transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-glow">
            <step.icon className="h-6 w-6" />
          </div>
          <div className="mt-5">
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-primary">
              Step {step.num}
            </div>
            <h3 className="mt-2 font-display text-lg font-bold tracking-tight text-foreground">
              {step.title}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {step.desc}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
