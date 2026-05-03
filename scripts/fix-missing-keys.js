import fs from 'fs';

const DICT_PATH = 'lib/i18n/dictionaries.js';
let content = fs.readFileSync(DICT_PATH, 'utf-8');

// Keys to add to each landing page namespace
const additions = {
  wedding: {
    en: {
      howItWorksTitle: 'Three simple steps for your big day',
      howItWorksDesc: 'Set up in seconds, collect memories all night',
      stepLabel: 'Step',
      step1Title: 'Create your wedding event',
      step1Desc: 'Name it after the couple. Get your unique link and QR code in seconds.',
      step2Title: 'Share with guests',
      step2Desc: 'Add the QR code to your invitations, table cards, or welcome signs.',
      step3Title: 'Collect every moment',
      step3Desc: 'Guests upload photos all night long. You wake up to a complete gallery.',
      emailPlaceholder: 'Your email',
      creating: 'Creating...',
      howItWorksLabel: 'How it works',
      viewPricing: 'View pricing',
    },
    de: {
      howItWorksTitle: 'Drei einfache Schritte für deinen großen Tag',
      howItWorksDesc: 'In Sekunden einrichten, die ganze Nacht Erinnerungen sammeln',
      stepLabel: 'Schritt',
      step1Title: 'Erstelle dein Hochzeits-Event',
      step1Desc: 'Benenne es nach dem Paar. Erhalte deinen einzigartigen Link und QR-Code in Sekunden.',
      step2Title: 'Mit Gästen teilen',
      step2Desc: 'Füge den QR-Code zu deinen Einladungen, Tischkarten oder Willkommensschildern hinzu.',
      step3Title: 'Sammle jeden Moment',
      step3Desc: 'Gäste laden die ganze Nacht lang Fotos hoch. Du wachst mit einer kompletten Galerie auf.',
      emailPlaceholder: 'Deine E-Mail',
      creating: 'Wird erstellt...',
      howItWorksLabel: 'So funktioniert\'s',
      viewPricing: 'Preise ansehen',
    },
    it: {
      howItWorksTitle: 'Tre semplici passi per il tuo grande giorno',
      howItWorksDesc: 'Configura in pochi secondi, raccogli ricordi tutta la notte',
      stepLabel: 'Passo',
      step1Title: 'Crea il tuo evento matrimonio',
      step1Desc: 'Chiamalo come la coppia. Ottieni il tuo link e codice QR unici in pochi secondi.',
      step2Title: 'Condividi con gli ospiti',
      step2Desc: "Aggiungi il codice QR ai tuoi inviti, carte da tavolo o cartelli di benvenuto.",
      step3Title: 'Raccogli ogni momento',
      step3Desc: 'Gli ospiti caricano foto tutta la notte. Ti svegli con una galleria completa.',
      emailPlaceholder: 'La tua email',
      creating: 'Creazione in corso...',
      howItWorksLabel: 'Come funziona',
      viewPricing: 'Vedi i prezzi',
    },
    fr: {
      howItWorksTitle: 'Trois étapes simples pour votre grand jour',
      howItWorksDesc: "Configurez en quelques secondes, collectez des souvenirs toute la nuit",
      stepLabel: 'Étape',
      step1Title: 'Créez votre événement de mariage',
      step1Desc: "Nommez-le d'après le couple. Obtenez votre lien et code QR uniques en quelques secondes.",
      step2Title: 'Partagez avec les invités',
      step2Desc: "Ajoutez le code QR à vos invitations, cartes de table ou panneaux de bienvenue.",
      step3Title: 'Collectez chaque moment',
      step3Desc: 'Les invités téléchargent des photos toute la nuit. Vous vous réveillez avec une galerie complète.',
      emailPlaceholder: 'Votre email',
      creating: 'Création en cours...',
      howItWorksLabel: 'Comment ça marche',
      viewPricing: 'Voir les tarifs',
    },
    es: {
      howItWorksTitle: 'Tres pasos simples para tu gran día',
      howItWorksDesc: 'Configura en segundos, recopila recuerdos toda la noche',
      stepLabel: 'Paso',
      step1Title: 'Crea tu evento de boda',
      step1Desc: 'Nómbralo como la pareja. Obtén tu link y código QR únicos en segundos.',
      step2Title: 'Comparte con los invitados',
      step2Desc: 'Agrega el código QR a tus invitaciones, tarjetas de mesa o carteles de bienvenida.',
      step3Title: 'Recopila cada momento',
      step3Desc: 'Los invitados suben fotos toda la noche. Te despiertas con una galería completa.',
      emailPlaceholder: 'Tu email',
      creating: 'Creando...',
      howItWorksLabel: 'Cómo funciona',
      viewPricing: 'Ver precios',
    },
  },
  birthday: {
    en: { emailPlaceholder: 'Your email', creating: 'Creating...', howItWorksLabel: 'How it works', viewPricing: 'View pricing' },
    de: { emailPlaceholder: 'Deine E-Mail', creating: 'Wird erstellt...', howItWorksLabel: 'So funktioniert\'s', viewPricing: 'Preise ansehen' },
    it: { emailPlaceholder: 'La tua email', creating: 'Creazione in corso...', howItWorksLabel: 'Come funziona', viewPricing: 'Vedi i prezzi' },
    fr: { emailPlaceholder: 'Votre email', creating: 'Création en cours...', howItWorksLabel: 'Comment ça marche', viewPricing: 'Voir les tarifs' },
    es: { emailPlaceholder: 'Tu email', creating: 'Creando...', howItWorksLabel: 'Cómo funciona', viewPricing: 'Ver precios' },
  },
  privateParty: {
    en: { emailPlaceholder: 'Your email', creating: 'Creating...', howItWorksLabel: 'How it works', viewPricing: 'View pricing' },
    de: { emailPlaceholder: 'Deine E-Mail', creating: 'Wird erstellt...', howItWorksLabel: 'So funktioniert\'s', viewPricing: 'Preise ansehen' },
    it: { emailPlaceholder: 'La tua email', creating: 'Creazione in corso...', howItWorksLabel: 'Come funziona', viewPricing: 'Vedi i prezzi' },
    fr: { emailPlaceholder: 'Votre email', creating: 'Création en cours...', howItWorksLabel: 'Comment ça marche', viewPricing: 'Voir les tarifs' },
    es: { emailPlaceholder: 'Tu email', creating: 'Creando...', howItWorksLabel: 'Cómo funciona', viewPricing: 'Ver precios' },
  },
  corporate: {
    en: { creating: 'Creating...', howItWorksLabel: 'How it works', viewPricing: 'View pricing' },
    de: { creating: 'Wird erstellt...', howItWorksLabel: 'So funktioniert\'s', viewPricing: 'Preise ansehen' },
    it: { creating: 'Creazione in corso...', howItWorksLabel: 'Come funziona', viewPricing: 'Vedi i prezzi' },
    fr: { creating: 'Création en cours...', howItWorksLabel: 'Comment ça marche', viewPricing: 'Voir les tarifs' },
    es: { creating: 'Creando...', howItWorksLabel: 'Cómo funciona', viewPricing: 'Ver precios' },
  },
  photographers: {
    en: { emailPlaceholder: 'Your email', creating: 'Creating...', howItWorksLabel: 'How it works', viewPricing: 'View pricing' },
    de: { emailPlaceholder: 'Deine E-Mail', creating: 'Wird erstellt...', howItWorksLabel: 'So funktioniert\'s', viewPricing: 'Preise ansehen' },
    it: { emailPlaceholder: 'La tua email', creating: 'Creazione in corso...', howItWorksLabel: 'Come funziona', viewPricing: 'Vedi i prezzi' },
    fr: { emailPlaceholder: 'Votre email', creating: 'Création en cours...', howItWorksLabel: 'Comment ça marche', viewPricing: 'Voir les tarifs' },
    es: { emailPlaceholder: 'Tu email', creating: 'Creando...', howItWorksLabel: 'Cómo funciona', viewPricing: 'Ver precios' },
  },
  planners: {
    en: { emailPlaceholder: 'Your email', creating: 'Creating...', howItWorksLabel: 'How it works', viewPricing: 'View pricing' },
    de: { emailPlaceholder: 'Deine E-Mail', creating: 'Wird erstellt...', howItWorksLabel: 'So funktioniert\'s', viewPricing: 'Preise ansehen' },
    it: { emailPlaceholder: 'La tua email', creating: 'Creazione in corso...', howItWorksLabel: 'Come funziona', viewPricing: 'Vedi i prezzi' },
    fr: { emailPlaceholder: 'Votre email', creating: 'Création en cours...', howItWorksLabel: 'Comment ça marche', viewPricing: 'Voir les tarifs' },
    es: { emailPlaceholder: 'Tu email', creating: 'Creando...', howItWorksLabel: 'Cómo funciona', viewPricing: 'Ver precios' },
  },
};

for (const [ns, locales] of Object.entries(additions)) {
  for (const [locale, keys] of Object.entries(locales)) {
    const localeIdx = content.indexOf('"' + locale + '": {');
    if (localeIdx === -1) continue;
    let nsIdx = content.indexOf('"' + ns + '": {', localeIdx);
    if (nsIdx === -1) continue;
    let depth = 0;
    let i = nsIdx + ('"' + ns + '": {').length;
    for (; i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') {
        if (depth === 0) break;
        depth--;
      }
    }
    const insertIdx = i;
    const newKeys = Object.entries(keys).map(([k, v]) => '        "' + k + '": "' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '",').join('\n');
    content = content.slice(0, insertIdx) + newKeys + '\n' + content.slice(insertIdx);
  }
}

fs.writeFileSync(DICT_PATH, content, 'utf-8');
console.log('Added missing keys to all namespaces.');
