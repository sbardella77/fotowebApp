// Private, token-based upload links: never index them. An expired or
// mistyped token would otherwise show up in Search Console as 404 / soft 404.
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function PhotographerUploadLayout({ children }) {
  return children
}
