'use client'

import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useMediaQuery } from '@/lib/hooks/use-media-query'

export function DashboardShell({
  sidebar,
  topBar,
  children,
  rightPanel,
  mobileWorkspaceOpen = false,
  onMobileWorkspaceOpenChange,
  onWorkspaceCloseAutoFocus,
  workspaceLabel,
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  // Single source of truth for which of the two workspace presentations is
  // mounted — see Phase 5C's architecture note: Radix Dialog's `modal`
  // behavior (focus trap, background blocking) is a JS prop, not
  // CSS-toggleable, so a CSS-only approach cannot give exactly one mounted
  // <EventDetailPanel> while keeping it modal on mobile and non-modal on
  // desktop. This is the ONLY viewport-detection usage in the dashboard
  // shell, deliberately narrow. Defaults to false (mobile/Sheet) on the
  // server and first paint; rightPanel is never part of the true SSR output
  // anyway (selectedEvent starts null), so this carries no hydration-
  // mismatch risk — only a sub-frame window where a closed Sheet renders
  // nothing.
  const isDesktopWorkspace = useMediaQuery('(min-width: 1280px)')

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-surface sticky top-0 h-screen">
        {sidebar}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-border bg-surface md:hidden">
            {sidebar}
          </aside>
        </>
      )}

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar with mobile toggle */}
        <div className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground hover:text-foreground md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">{topBar}</div>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1">
          <div className="flex flex-col xl:flex-row">
            <div className="flex-1 min-w-0">{children}</div>
            {/* Desktop xl+: rightPanel mounts here, as a persistent
                non-modal sticky column — never inside the Sheet at the same
                time (see isDesktopWorkspace above). */}
            {isDesktopWorkspace && rightPanel && (
              <div className="w-[420px] shrink-0 border-l border-border bg-elevated sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto scrollbar-thin">
                <div className="h-full">{rightPanel}</div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Below xl: rightPanel mounts here instead, inside the modal Manage
          Sheet — never alongside the desktop column above. Crossing the xl
          breakpoint remounts EventDetailPanel fresh (its internal activeTab
          resets to Overview); this is an accepted, documented trade-off for
          guaranteeing exactly one mounted workspace instance at a time. */}
      {!isDesktopWorkspace && (
        <Sheet open={mobileWorkspaceOpen} onOpenChange={onMobileWorkspaceOpenChange}>
          <SheetContent
            side="right"
            onCloseAutoFocus={onWorkspaceCloseAutoFocus}
            className="flex w-full flex-col overflow-hidden p-0 sm:max-w-md"
          >
            <SheetTitle className="sr-only">{workspaceLabel}</SheetTitle>
            <div className="flex-1 overflow-y-auto">{rightPanel}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
