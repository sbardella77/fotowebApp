import './globals.css'

export const metadata = {
  title: 'SnapRooms — Every Guest Photo. One Room.',
  description: 'Create a room, share a QR code, and collect every guest photo instantly. No app download, no signup needed.',
}

function App({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: 'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);' }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}

export default App
