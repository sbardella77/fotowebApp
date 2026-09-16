// Last-resort error UI must not depend on the normal provider/dictionary
// tree — that tree may itself be the thing that failed. This module is
// self-contained: no React, no router, no dictionaries.js.

const SUPPORTED_LOCALES = ['en', 'de', 'it', 'fr', 'es', 'pt-BR']
const DEFAULT_LOCALE = 'en'
const COOKIE_NAME = 'NEXT_LOCALE'

const COPY = {
  en: {
    globalTitle: 'Something went wrong',
    globalBody: "We couldn't load this page. Please try again.",
    dashboardTitle: 'Dashboard unavailable',
    dashboardBody: "We couldn't load your dashboard. Please try again.",
    eventTitle: "We couldn't load this gallery.",
    eventBody: 'Please try again or contact the host.',
    reloadPage: 'Reload page',
    backToHome: 'Back to home',
  },
  de: {
    globalTitle: 'Ein Fehler ist aufgetreten',
    globalBody: 'Diese Seite konnte leider nicht geladen werden. Bitte versuchen Sie es erneut.',
    dashboardTitle: 'Dashboard nicht verfügbar',
    dashboardBody: 'Ihr Dashboard konnte leider nicht geladen werden. Bitte versuchen Sie es erneut.',
    eventTitle: 'Diese Galerie konnte leider nicht geladen werden.',
    eventBody: 'Bitte versuchen Sie es erneut oder wenden Sie sich an den Gastgeber.',
    reloadPage: 'Seite neu laden',
    backToHome: 'Zurück zur Startseite',
  },
  it: {
    globalTitle: 'Si è verificato un errore',
    globalBody: 'Non è stato possibile caricare questa pagina. Riprova.',
    dashboardTitle: 'Dashboard non disponibile',
    dashboardBody: 'Non è stato possibile caricare la tua dashboard. Riprova.',
    eventTitle: 'Non è stato possibile caricare questa galleria.',
    eventBody: "Riprova oppure contatta l'organizzatore.",
    reloadPage: 'Ricarica pagina',
    backToHome: 'Torna alla home',
  },
  fr: {
    globalTitle: "Une erreur s'est produite",
    globalBody: "Cette page n'a pas pu être chargée. Veuillez réessayer.",
    dashboardTitle: 'Tableau de bord indisponible',
    dashboardBody: "Votre tableau de bord n'a pas pu être chargé. Veuillez réessayer.",
    eventTitle: "Cette galerie n'a pas pu être chargée.",
    eventBody: "Veuillez réessayer ou contacter l'hôte.",
    reloadPage: 'Recharger la page',
    backToHome: "Retour à l'accueil",
  },
  es: {
    globalTitle: 'Se produjo un error',
    globalBody: 'No se pudo cargar esta página. Inténtalo de nuevo.',
    dashboardTitle: 'Panel no disponible',
    dashboardBody: 'No se pudo cargar tu panel. Inténtalo de nuevo.',
    eventTitle: 'No se pudo cargar esta galería.',
    eventBody: 'Inténtalo de nuevo o contacta al anfitrión.',
    reloadPage: 'Recargar página',
    backToHome: 'Volver al inicio',
  },
  'pt-BR': {
    globalTitle: 'Algo deu errado',
    globalBody: 'Não foi possível carregar esta página. Tente novamente.',
    dashboardTitle: 'Painel indisponível',
    dashboardBody: 'Não foi possível carregar seu painel. Tente novamente.',
    eventTitle: 'Não foi possível carregar esta galeria.',
    eventBody: 'Tente novamente ou entre em contato com o anfitrião.',
    reloadPage: 'Recarregar página',
    backToHome: 'Voltar para o início',
  },
}

function normalizeLanguageTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) return null
  const lower = tag.toLowerCase()

  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lower)
  if (exact) return exact

  // Fall back to primary-subtag match, e.g. a bare "pt" or "pt-PT" browser
  // tag still resolves to "pt-BR", the only Portuguese variant offered.
  const primary = lower.split('-')[0]
  return SUPPORTED_LOCALES.find((l) => l.toLowerCase().split('-')[0] === primary) || null
}

function readCookieLocale() {
  try {
    if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null
    const pairs = document.cookie.split(';')
    for (const pair of pairs) {
      const separatorIndex = pair.indexOf('=')
      if (separatorIndex === -1) continue
      const key = pair.slice(0, separatorIndex).trim()
      if (key !== COOKIE_NAME) continue
      const value = decodeURIComponent(pair.slice(separatorIndex + 1).trim())
      return SUPPORTED_LOCALES.includes(value) ? value : null
    }
    return null
  } catch {
    return null
  }
}

function readNavigatorLocale() {
  try {
    if (typeof navigator === 'undefined') return null
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language]
    for (const candidate of candidates) {
      const normalized = normalizeLanguageTag(candidate)
      if (normalized) return normalized
    }
    return null
  } catch {
    return null
  }
}

export function resolveErrorBoundaryLocale() {
  return readCookieLocale() || readNavigatorLocale() || DEFAULT_LOCALE
}

export function getErrorBoundaryCopy(locale) {
  const localeCopy = COPY[locale] || {}
  const englishCopy = COPY[DEFAULT_LOCALE]
  const merged = {}
  for (const key of Object.keys(englishCopy)) {
    merged[key] = localeCopy[key] || englishCopy[key]
  }
  return merged
}
