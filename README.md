# Moment

**The easiest way to collect photos from everyone at your event.**

Create a shared gallery, share a link or QR code, and watch photos arrive from your guests. No apps to download, no accounts to create.

[Live Demo](https://your-domain.com) • [Create Event](#) • [How it Works](#how-it-works)

---

## What is Moment?

Moment is a live event photo-sharing platform designed for weddings, parties, corporate events, and any gathering where guests are taking photos.

Instead of chasing photos across WhatsApp groups, email threads, and social media DMs, Moment gives you one simple link that collects every photo in a beautiful shared gallery.

### The Problem We Solve

- **Photos scattered everywhere** — Some in WhatsApp, some in iMessage, some in Instagram DMs
- **Manual collection** — You have to ask, download, and organize them yourself
- **Photos get lost** — By the time you remember to ask, guests have already deleted them

### Our Solution

One link. One gallery. Zero effort.

---

## Features

### Core Experience

- ✨ **Instant Event Creation** — Create an event in 10 seconds
- 📱 **No App Required** — Guests open a link and upload directly
- 🔗 **Simple Sharing** — Link, QR code, or social share
- 📸 **Real-time Gallery** — Watch photos appear as guests upload
- 💾 **Full Quality** — Original resolution preserved

### QR Code Sharing

- 📋 **Table Cards** — 4×6 inch cards for guest tables
- 🖼️ **Entrance Posters** — A4 and A5 sizes for displays
- 💻 **Digital Share** — Link works in invites, texts, email
- 🎨 **Clean Design** — Matches your event aesthetic
- 🎯 **Event-Specific Copy** — QR headlines and instructions adapt to weddings, birthdays, parties, and corporate events
- 🔓 **No App Needed** — Universal trust line on every QR card to reduce guest friction

### For Event Organizers

- 🎯 **Event Code** — Simple 6-character code for easy sharing
- 🖨️ **Print-Ready QR** — Download PNGs for any use
- 📊 **Photo Counter** — See how many photos you've collected
- 🔄 **Auto-Refresh** — Gallery updates automatically

---

## Use Cases

### 💒 Weddings
Place a QR card on each table. Guests scan and upload candid moments throughout the night. You'll wake up to hundreds of photos you never would have seen.

### 🎉 Birthday Parties
From milestone birthdays to surprise parties. Collect all the fun moments in one place without the social media noise.

### 🏢 Corporate Events
Conferences, team building, company celebrations. Professional photo collection made simple with branded sharing options.

---

## How it Works

### 1. Create Your Event
Enter your event name and get an instant event code and QR code.

### 2. Share with Guests
Send the link in your invitation, display the QR code at your venue, or share digitally.

### 3. Collect Photos
Guests tap, upload, and photos appear in your gallery instantly. No accounts, no apps.

---

## Tech Stack

- **Framework**: [Next.js 14](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)
- **Database**: MongoDB + Prisma
- **Storage**: Vercel Blob
- **Deployment**: Vercel

---

## Getting Started

### Prerequisites

- Node.js 18+ 
- MongoDB database
- Vercel account (for Blob storage)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/moment.git
cd moment

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Run database migrations
npm run prisma:generate

# Start development server
npm run dev
```

### Environment Variables

```env
# Database
DATABASE_URL="mongodb+srv://user:password@cluster.mongodb.net/moment"

# Vercel Blob
BLOB_READ_WRITE_TOKEN="vercel_blob_token_here"

# Optional: Analytics, Monitoring, etc.
```

---

## Project Structure

```
fotowebApp/
├── app/                    # Next.js App Router
│   ├── page.js            # Landing page + Event app
│   ├── layout.js          # Root layout
│   ├── globals.css        # Global styles
│   ├── event/
│   │   └── [slug]/
│   │       ├── page.js    # Event redirect
│   │       └── print/     # QR print page
│   └── api/               # API routes
├── components/
│   ├── landing-page.jsx   # Marketing landing page
│   ├── event-qr-modal.jsx # QR sharing modal
│   ├── ui/                # shadcn/ui components
│   └── ...
├── lib/                   # Utilities & helpers
│   └── qr-copy.js         # Event-type-specific QR copy mapping
├── prisma/               # Database schema
└── public/               # Static assets
```

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/events` | List all events |
| POST | `/api/events` | Create new event |
| GET | `/api/events/:slug` | Get event details |
| POST | `/api/uploads/init` | Initialize upload |
| POST | `/api/uploads/chunk` | Upload chunk |
| POST | `/api/uploads/complete` | Finalize upload |

---

## Design Principles

### Mobile-First
Every feature is designed for mobile use first. Guests will upload from their phones — we make that experience frictionless.

### Zero Friction
No apps to download. No accounts to create. No passwords to remember. Just tap and upload.

### Elegant & Minimal
Clean design that works for weddings, corporate events, and casual parties alike. No clutter, no distractions.

---

## Roadmap

- [ ] Password-protected events
- [ ] Photo moderation tools
- [ ] Custom branding options
- [ ] Batch download as ZIP
- [ ] Guest commenting on photos
- [x] Event-specific QR copy (wedding, birthday, party, corporate)
- [ ] Event templates (themes, colors, layouts)

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

```bash
# Create a branch
git checkout -b feature/your-feature

# Make changes
# ...

# Run tests
npm test

# Submit PR
git push origin feature/your-feature
```

---

## License

[MIT](LICENSE) © Moment

---

## Support

Have questions or need help?

- 📧 Email: support@moment.app
- 💬 Twitter: [@moment](https://twitter.com/moment)
- 📖 Docs: [docs.moment.app](https://docs.moment.app)

---

<p align="center">
  Made with ❤️ for event hosts everywhere
</p>
