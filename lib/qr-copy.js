const QR_COPY = {
  wedding: {
    headline: 'Share your wedding photos 📸',
    instruction: 'Scan and add your moments',
  },
  birthday: {
    headline: 'Add your birthday photos 🎂',
    instruction: 'Scan and share your moments',
  },
  party: {
    headline: 'Share your party photos 🎉',
    instruction: 'Scan and join the fun',
  },
  corporate: {
    headline: 'Upload event photos 📸',
    instruction: 'Scan to contribute',
  },
  generic: {
    headline: 'Add your photos 📸',
    instruction: 'Scan to join',
  },
}

export function getQRCopy(eventType) {
  const type = QR_COPY[eventType] ? eventType : 'generic'
  return {
    ...QR_COPY[type],
    trustLine: 'No app needed',
  }
}
