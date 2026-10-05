import { DashboardIdleLogout } from '@/app/dashboard/components/idle-logout'

export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function DashboardLayout({ children }) {
  return (
    <div className="min-h-screen bg-background">
      <DashboardIdleLogout />
      {children}
    </div>
  )
}
