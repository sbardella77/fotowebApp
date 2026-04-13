import './globals.css'

export const metadata = {
  title: 'Moment — Collect Every Photo From Your Event',
  description: 'The easiest way to collect photos from everyone at your wedding, party, or event. No app download, no sign-up — guests just scan and upload.',
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
