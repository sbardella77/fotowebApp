export const metadata = {
  title: 'Privacy Policy — SnapRooms',
  description: 'How SnapRooms collects, uses, and protects your data.',
}

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function Bullet({ children }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
      <span>{children}</span>
    </li>
  )
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto max-w-2xl px-4 py-16 sm:py-24">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        <Section title="What data we collect">
          <p>We collect only the data needed to run SnapRooms:</p>
          <ul className="space-y-2">
            <Bullet><strong>Email address</strong> — when you create a room or sign in as an owner.</Bullet>
            <Bullet><strong>Optional guest name</strong> — when a guest uploads a photo and chooses to share it.</Bullet>
            <Bullet><strong>Uploaded photos</strong> — images guests add to a room.</Bullet>
            <Bullet><strong>Room metadata</strong> — room name, slug, creation date, and related settings.</Bullet>
            <Bullet><strong>IP address</strong> — implicitly collected via server logs and used for security (rate limiting).</Bullet>
          </ul>
        </Section>

        <Section title="Why we process your data">
          <ul className="space-y-2">
            <Bullet>To create and manage rooms for event organizers.</Bullet>
            <Bullet>To let guests upload and share photos within a room.</Bullet>
            <Bullet>To authenticate owners and protect account access.</Bullet>
            <Bullet>To send password recovery and room-setup emails.</Bullet>
            <Bullet>To prevent abuse and spam through rate limiting.</Bullet>
          </ul>
        </Section>

        <Section title="How we store your data">
          <ul className="space-y-2">
            <Bullet><strong>Database:</strong> Room and owner data is stored in PostgreSQL (Neon).</Bullet>
            <Bullet><strong>File storage:</strong> Photos are stored in secure blob storage.</Bullet>
            <Bullet><strong>Passwords:</strong> Owner passwords are hashed with salt — we never store plain text passwords.</Bullet>
            <Bullet><strong>Tokens:</strong> Session and recovery tokens are time-limited and cryptographically signed.</Bullet>
          </ul>
        </Section>

        <Section title="Who can access your data">
          <ul className="space-y-2">
            <Bullet><strong>Room owners</strong> can view and manage the rooms and photos they own.</Bullet>
            <Bullet><strong>Guests</strong> can only view and upload photos to the specific room they have a link or QR code for.</Bullet>
            <Bullet><strong>We do not</strong> sell, share, or publicly index your data.</Bullet>
          </ul>
        </Section>

        <Section title="Security measures">
          <ul className="space-y-2">
            <Bullet>Passwords are hashed with industry-standard algorithms.</Bullet>
            <Bullet>Session tokens are signed and expire automatically.</Bullet>
            <Bullet>Rate limiting protects against brute-force and spam attacks.</Bullet>
            <Bullet>HTTPS is enforced for all traffic.</Bullet>
          </ul>
        </Section>

        <Section title="Data retention">
          <ul className="space-y-2">
            <Bullet><strong>Owner accounts:</strong> Retained until you delete your rooms or request account deletion.</Bullet>
            <Bullet><strong>Rooms:</strong> Retained until deleted by the owner.</Bullet>
            <Bullet><strong>Photos:</strong> Deleted automatically when the associated room is deleted.</Bullet>
            <Bullet><strong>Recovery tokens:</strong> Expire automatically after 30 minutes.</Bullet>
            <Bullet><strong>Setup tokens:</strong> Expire automatically after 24 hours.</Bullet>
            <Bullet><strong>Server logs:</strong> Short-term retention for debugging and security only.</Bullet>
          </ul>
        </Section>

        <Section title="Your rights (GDPR)">
          <p>Under GDPR and similar privacy laws, you have the right to:</p>
          <ul className="space-y-2">
            <Bullet><strong>Access</strong> — request a copy of the data we hold about you.</Bullet>
            <Bullet><strong>Correction</strong> — ask us to correct inaccurate or incomplete data.</Bullet>
            <Bullet><strong>Deletion</strong> — request deletion of your personal data and rooms.</Bullet>
            <Bullet><strong>Restriction</strong> — ask us to limit how we use your data.</Bullet>
            <Bullet><strong>Portability</strong> — receive your data in a structured format.</Bullet>
          </ul>
        </Section>

        <Section title="How to request deletion">
          <p>
            You can delete a room and its photos at any time from your dashboard.
            If you want us to delete all data associated with your email address,
            contact us at{' '}
            <a href="mailto:hello@snaprooms.app" className="text-primary underline underline-offset-4 hover:text-primary/80">
              hello@snaprooms.app
            </a>.
          </p>
          <p className="mt-2">
            We will process deletion requests within 30 days and confirm once completed.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about privacy? Reach us at{' '}
            <a href="mailto:hello@snaprooms.app" className="text-primary underline underline-offset-4 hover:text-primary/80">
              hello@snaprooms.app
            </a>.
          </p>
        </Section>

        <div className="mt-12 border-t pt-8 text-center">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
          >
            ← Back to SnapRooms
          </a>
        </div>
      </div>
    </main>
  )
}
