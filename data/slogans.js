/**
 * SnapRooms Slogan Library
 * Structured copy assets by target segment.
 *
 * Usage:
 *   import { SLOGANS } from '@/data/slogans'
 *   const birthday = SLOGANS.birthday
 */

export const SLOGANS = {
  wedding: {
    short: [
      'Every guest photo. One beautiful room.',
      'Collect the moments you did not see.',
      'Your wedding, every angle.',
      'All your guest photos, finally together.',
      'No app. No signup. Just memories.',
      'The easiest way to gather wedding photos.',
      'One QR code. A lifetime of moments.',
      'Let your guests be your second photographer.',
      'Preserve every smile, every tear.',
      'Your love story, told by everyone.',
    ],
    headlines: [
      'Wedding photo sharing made simple — for couples who want every moment.',
      'Collect every guest photo in one private gallery. No apps. No hassle.',
      'The wedding photo solution that actually works for your guests.',
      'Stop chasing photos after your big day. Start collecting them in real time.',
      'Your guests take hundreds of photos. Make sure you get to see them all.',
    ],
    whatsapp: [
      'Share a QR code at your wedding and collect every guest photo instantly 📸',
      'Want all your wedding photos in one place? Create a SnapRooms room in 10 seconds.',
      'No apps, no signup — just scan, upload, and relive every moment.',
    ],
    social: [
      'What if you could see every photo your wedding guests took? 🎞️',
      'One QR code. Every guest. All the photos you never knew existed.',
      'Your photographer captures the moments. Your guests capture the magic.',
    ],
  },

  birthday: {
    short: [
      'Every candle. Every laugh. One room.',
      'Collect birthday moments from every guest.',
      'Your party, every photo.',
      'Make every birthday unforgettable.',
      'No app needed — just cake and cameras.',
      'The easiest way to gather party pics.',
      'One link. All the fun.',
      'Let your friends fill your gallery.',
      'Birthday memories, instantly shared.',
      'Every snapshot, every smile, yours.',
    ],
    headlines: [
      'Birthday photo sharing that feels like part of the party.',
      'Collect every silly, sweet, and spontaneous birthday photo in one place.',
      'No apps, no signup — just pure birthday fun, captured by everyone.',
      'The birthday photo album that builds itself while you blow out the candles.',
      'Your friends take the best photos. Now you can actually keep them.',
    ],
    whatsapp: [
      'Throwing a party? Share a QR code and collect every guest photo instantly 🎂',
      'Create a SnapRooms room for your birthday — guests upload photos in seconds, no app needed.',
      'Want all your party photos in one place? Takes 10 seconds to set up.',
    ],
    social: [
      'What if every birthday guest could add their photos to one album? 🎉',
      'Your party deserves more than a scattered group chat of photos.',
      'Blow out the candles. Cut the cake. Collect every photo automatically.',
    ],
  },

  privateParty: {
    short: [
      'The party starts here. The photos stay together.',
      'One room. All the moments. Zero hassle.',
      'Your friends take photos. You keep them all.',
      'The social way to collect party photos.',
      'No app. No signup. Just good times.',
      'Gather every shot from the night.',
      'Your party, your gallery, your rules.',
      'Instant photo collection for any crowd.',
      'Share the link. Watch the gallery grow.',
      'From pre-game to after-party — every pic.',
    ],
    headlines: [
      'The easiest way to collect photos from any night out.',
      'Your friends take photos. You get the gallery. No apps required.',
      'One QR code. One private room. Every photo from the night.',
      'Stop begging friends for photos the morning after. Start collecting them live.',
      'Private photo sharing that actually works for parties, dinners, and get-togethers.',
    ],
    whatsapp: [
      'Hosting a party? Drop a QR code and watch the photo gallery fill itself 🍾',
      'Create a private photo room for your party — guests upload instantly, no app needed.',
      'Tired of chasing friends for party photos? This fixes that in 10 seconds.',
    ],
    social: [
      'What if you could collect every party photo without a single group chat? 🥂',
      'The best parties have the worst photo logistics. Until now.',
      'Share a link. Let the gallery tell the story of the night.',
    ],
  },

  corporateEvent: {
    short: [
      'Every attendee photo. One professional gallery.',
      'Collect event photos with zero IT overhead.',
      'Team moments, captured by everyone.',
      'Event photo collection, enterprise-simple.',
      'No apps. No training. Just results.',
      'The professional way to gather event photos.',
      'One QR code. Every department. All the photos.',
      'Event coverage from every angle.',
      'Amplify your event photography instantly.',
      'Your event, documented by the people who lived it.',
    ],
    headlines: [
      'Enterprise event photo collection without the enterprise complexity.',
      'Give every attendee a voice — and a camera — with one simple QR code.',
      'The professional photo solution for conferences, offsites, and company events.',
      'Collect authentic event photos from your team, not just the photographer.',
      'Event marketing gold: real photos from real attendees, gathered automatically.',
    ],
    whatsapp: [
      'Running a company event? Share a QR code and collect attendee photos instantly 📸',
      'SnapRooms: zero IT setup, zero app installs, every team photo in one gallery.',
      'Need event photos from every angle? Create a room in 10 seconds.',
    ],
    social: [
      'What if your attendees could contribute to the official event photo gallery? 📊',
      'Your photographer captures the stage. Your attendees capture the experience.',
      'One QR code. Zero IT tickets. A complete visual record of your event.',
    ],
  },
}

/**
 * Flattened exports for convenience.
 */
export const WEDDAN_SLOGANS = SLOGANS.wedding
export const BIRTHDAY_SLOGANS = SLOGANS.birthday
export const PRIVATE_PARTY_SLOGANS = SLOGANS.privateParty
export const CORPORATE_EVENT_SLOGANS = SLOGANS.corporateEvent
