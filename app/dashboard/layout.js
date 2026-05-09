export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function DashboardLayout({ children }) {
  return <div className="dark min-h-screen bg-background">{children}</div>
}
