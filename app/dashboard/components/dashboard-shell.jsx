'use client'

import { Menu, X } from 'lucide-react'
import { useState } from 'react'

export function DashboardShell({ sidebar, topBar, children, rightPanel }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

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
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-raised text-muted-foreground hover:text-foreground md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex-1">{topBar}</div>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1">
          <div className="flex flex-col xl:flex-row">
            <div className="flex-1 min-w-0">{children}</div>
            {rightPanel && (
              <div className="w-full px-4 pb-8 sm:px-6 lg:px-8 xl:w-[420px] xl:shrink-0 xl:border-l xl:border-border xl:bg-elevated xl:px-0 xl:pb-0 xl:sticky xl:top-16 xl:h-[calc(100vh-4rem)] xl:overflow-y-auto xl:scrollbar-thin">
                <div className="bg-surface border border-border rounded-xl shadow-subtle xl:h-full xl:rounded-none xl:border-0 xl:bg-transparent xl:shadow-none">
                  {rightPanel}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
