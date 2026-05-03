import fs from 'fs';

const DICT_PATH = 'lib/i18n/dictionaries.js';
let content = fs.readFileSync(DICT_PATH, 'utf-8');

const faqs = {
  en: {
    pricingFaq1Question: 'Can I really use SnapRooms for free?',
    pricingFaq1Answer: 'Yes. The free plan gives you one active room and up to 50 photos. It is perfect for trying SnapRooms or hosting a small casual event. Guests always upload for free — they never pay. Standard-quality photo downloads are also free. Original-quality downloads require a one-time €1.99 unlock per room on the Free plan.',
    pricingFaq2Question: 'What is the difference between Pro Event and Wedding Pro?',
    pricingFaq2Answer: 'Both are one-time per-event purchases with unlimited photos and guests. Wedding Pro adds wedding-specific QR signage assets, longer post-event gallery access, and a premium experience tailored for weddings.',
    pricingFaq3Question: 'Do guests need to sign up or install an app?',
    pricingFaq3Answer: 'No. Guests simply scan your QR code or open your room link and upload photos instantly from any phone. Zero friction, zero downloads, zero cost. Original-quality photo downloads on Free rooms require a one-time €1.99 room unlock, which the room owner can purchase.',
    pricingFaq4Question: 'Why is Professional priced monthly instead of per event?',
    pricingFaq4Answer: 'Professional is built for photographers, planners, and venues who run events repeatedly for clients. A monthly subscription keeps costs predictable as you scale from one client event to the next.',
    pricingFaq5Question: 'Can I use SnapRooms as part of my paid photography or planning services?',
    pricingFaq5Answer: 'Yes. The Professional and Business plans include commercial use rights. You can create rooms for clients, deliver galleries, and include SnapRooms as part of your service packages.',
    pricingFaq6Question: 'Do you offer custom pricing for agencies or corporate teams?',
    pricingFaq6Answer: 'Yes. Our Business tier is designed for organizations that need volume pricing, invoicing, or custom terms. Contact us at hello@snaprooms.app and we will reply within one business day.',
  },
  de: {
    pricingFaq1Question: 'Kann ich SnapRooms wirklich kostenlos nutzen?',
    pricingFaq1Answer: 'Ja. Der kostenlose Plan gibt dir einen aktiven Raum und bis zu 50 Fotos. Er ist perfekt, um SnapRooms auszuprobieren oder ein kleines, lockeres Event zu veranstalten. Gäste laden immer kostenlos hoch — sie zahlen nie. Downloads in Standardqualität sind ebenfalls kostenlos. Downloads in Originalqualität erfordern eine einmalige Freischaltung von €1,99 pro Raum im Free-Plan.',
    pricingFaq2Question: 'Was ist der Unterschied zwischen Pro Event und Wedding Pro?',
    pricingFaq2Answer: 'Beide sind einmalige Käufe pro Event mit unbegrenzten Fotos und Gästen. Wedding Pro fügt Hochzeits-Assets für QR-Schilder, längeren Galeriezugang nach dem Event und ein Premium-Erlebnis speziell für Hochzeiten hinzu.',
    pricingFaq3Question: 'Müssen Gäste sich anmelden oder eine App installieren?',
    pricingFaq3Answer: 'Nein. Gäste scannen einfach deinen QR-Code oder öffnen deinen Raum-Link und laden Fotos sofort von jedem Telefon hoch. Null Reibung, null Downloads, null Kosten. Downloads in Originalqualität bei Free-Räumen erfordern eine einmalige Freischaltung von €1,99, die der Raumbesitzer kaufen kann.',
    pricingFaq4Question: 'Warum ist Professional monatlich und nicht pro Event bepreist?',
    pricingFaq4Answer: 'Professional ist für Fotografen, Planer und Venues konzipiert, die wiederholt Events für Kunden durchführen. Ein monatliches Abonnement hält die Kosten vorhersagbar, während du von einem Kundenevent zum nächsten skalierst.',
    pricingFaq5Question: 'Kann ich SnapRooms als Teil meiner bezahlten Fotografie- oder Planungsdienste nutzen?',
    pricingFaq5Answer: 'Ja. Die Professional- und Business-Pläne beinhalten kommerzielle Nutzungsrechte. Du kannst Räume für Kunden erstellen, Galerien liefern und SnapRooms als Teil deiner Servicepakete einbinden.',
    pricingFaq6Question: 'Bietet ihr individuelle Preise für Agenturen oder Firmen?',
    pricingFaq6Answer: 'Ja. Unsere Business-Stufe ist für Organisationen konzipiert, die Mengenrabatte, Rechnungsstellung oder individuelle Konditionen benötigen. Kontaktiere uns unter hello@snaprooms.app — wir antworten innerhalb eines Werktags.',
  },
  it: {
    pricingFaq1Question: 'Posso davvero usare SnapRooms gratis?',
    pricingFaq1Answer: "Sì. Il piano gratuito ti dà uno spazio attivo e fino a 50 foto. È perfetto per provare SnapRooms o ospitare un piccolo evento informale. Gli ospiti caricano sempre gratis — non pagano mai. I download a qualità standard sono anch'essi gratis. I download a qualità originale richiedono uno sblocco una tantum di €1,99 per spazio nel piano Free.",
    pricingFaq2Question: "Qual è la differenza tra Pro Event e Wedding Pro?",
    pricingFaq2Answer: "Entrambi sono acquisti una tantum per evento con foto e ospiti illimitati. Wedding Pro aggiunge asset per segnaletica QR matrimonio, accesso alla galleria più lungo dopo l'evento e un'esperienza premium su misura per matrimoni.",
    pricingFaq3Question: "Gli ospiti devono registrarsi o installare un'app?",
    pricingFaq3Answer: "No. Gli ospiti semplicemente scansionano il tuo codice QR o aprono il link del tuo spazio e caricano foto istantaneamente da qualsiasi telefono. Zero attrito, zero download, zero costi. I download a qualità originale negli spazi Free richiedono uno sblocco una tantum di €1,99, che il proprietario dello spazio può acquistare.",
    pricingFaq4Question: "Perché Professional è a prezzo mensile invece che per evento?",
    pricingFaq4Answer: "Professional è pensato per fotografi, planner e venue che gestiscono eventi ripetutamente per clienti. Un abbonamento mensile mantiene i costi prevedibili mentre passi da un evento cliente all'altro.",
    pricingFaq5Question: "Posso usare SnapRooms come parte dei miei servizi di fotografia o pianificazione a pagamento?",
    pricingFaq5Answer: "Sì. I piani Professional e Business includono diritti di uso commerciale. Puoi creare spazi per clienti, consegnare gallerie e includere SnapRooms nei tuoi pacchetti di servizi.",
    pricingFaq6Question: "Offrite prezzi personalizzati per agenzie o team aziendali?",
    pricingFaq6Answer: "Sì. Il nostro livello Business è progettato per organizzazioni che necessitano di prezzi per volumi, fatturazione o condizioni personalizzate. Contattaci a hello@snaprooms.app e ti risponderemo entro un giorno lavorativo.",
  },
  fr: {
    pricingFaq1Question: "Puis-je vraiment utiliser SnapRooms gratuitement ?",
    pricingFaq1Answer: "Oui. Le forfait gratuit vous donne une salle active et jusqu'à 50 photos. Il est parfait pour essayer SnapRooms ou organiser un petit événement informel. Les invités téléchargent toujours gratuitement — ils ne paient jamais. Les téléchargements en qualité standard sont également gratuits. Les téléchargements en résolution originale nécessitent un déblocage unique de €1,99 par salle sur le forfait Gratuit.",
    pricingFaq2Question: "Quelle est la différence entre Pro Event et Wedding Pro ?",
    pricingFaq2Answer: "Les deux sont des achats uniques par événement avec des photos et des invités illimités. Wedding Pro ajoute des supports de signalisation QR spécifiques aux mariages, un accès prolongé à la galerie après l'événement et une expérience premium adaptée aux mariages.",
    pricingFaq3Question: "Les invités doivent-ils s'inscrire ou installer une app ?",
    pricingFaq3Answer: "Non. Les invités scannent simplement votre code QR ou ouvrent le lien de votre salle et téléchargent des photos instantanément depuis n'importe quel téléphone. Zéro friction, zéro téléchargement, zéro coût. Les téléchargements en résolution originale sur les salles Gratuites nécessitent un déblocage unique de €1,99, que le propriétaire de la salle peut acheter.",
    pricingFaq4Question: "Pourquoi Professional est-il tarifé mensuellement au lieu de par événement ?",
    pricingFaq4Answer: "Professional est conçu pour les photographes, planificateurs et lieux qui organisent des événements de manière répétée pour des clients. Un abonnement mensuel permet de prévoir les coûts à mesure que vous passez d'un événement client à l'autre.",
    pricingFaq5Question: "Puis-je utiliser SnapRooms dans le cadre de mes services de photographie ou de planification rémunérés ?",
    pricingFaq5Answer: "Oui. Les forfaits Professional et Business incluent des droits d'utilisation commerciale. Vous pouvez créer des salles pour des clients, livrer des galeries et inclure SnapRooms dans vos forfaits de services.",
    pricingFaq6Question: "Proposez-vous des tarifs personnalisés pour les agences ou les équipes d'entreprise ?",
    pricingFaq6Answer: "Oui. Notre niveau Business est conçu pour les organisations qui ont besoin de tarifs de volume, de facturation ou de conditions personnalisées. Contactez-nous à hello@snaprooms.app et nous vous répondrons dans un jour ouvrable.",
  },
  es: {
    pricingFaq1Question: '¿Puedo usar SnapRooms realmente gratis?',
    pricingFaq1Answer: 'Sí. El plan gratuito te da un espacio activo y hasta 50 fotos. Es perfecto para probar SnapRooms o organizar un pequeño evento informal. Los invitados siempre suben gratis — nunca pagan. Las descargas a calidad estándar también son gratis. Las descargas a resolución original requieren un desbloqueo único de €1,99 por espacio en el plan Free.',
    pricingFaq2Question: '¿Cuál es la diferencia entre Pro Event y Wedding Pro?',
    pricingFaq2Answer: 'Ambos son compras únicas por evento con fotos e invitados ilimitados. Wedding Pro agrega assets de señalización QR específicos para bodas, acceso más prolongado a la galería después del evento y una experiencia premium diseñada para bodas.',
    pricingFaq3Question: '¿Los invitados necesitan registrarse o instalar una app?',
    pricingFaq3Answer: 'No. Los invitados simplemente escanean tu código QR o abren el link de tu espacio y suben fotos al instante desde cualquier teléfono. Cero fricción, cero descargas, cero costo. Las descargas a resolución original en espacios Free requieren un desbloqueo único de €1,99, que el propietario del espacio puede comprar.',
    pricingFaq4Question: '¿Por qué Professional tiene precio mensual en lugar de por evento?',
    pricingFaq4Answer: 'Professional está diseñado para fotógrafos, planificadores y venues que organizan eventos repetidamente para clientes. Una suscripción mensual mantiene los costos predecibles a medida que escalas de un evento de cliente al siguiente.',
    pricingFaq5Question: '¿Puedo usar SnapRooms como parte de mis servicios de fotografía o planificación pagados?',
    pricingFaq5Answer: 'Sí. Los planes Professional y Business incluyen derechos de uso comercial. Puedes crear espacios para clientes, entregar galerías e incluir SnapRooms como parte de tus paquetes de servicios.',
    pricingFaq6Question: '¿Ofrecen precios personalizados para agencias o equipos corporativos?',
    pricingFaq6Answer: 'Sí. Nuestro nivel Business está diseñado para organizaciones que necesitan precios por volumen, facturación o términos personalizados. Contáctanos en hello@snaprooms.app y te responderemos dentro de un día hábil.',
  },
};

for (const [locale, keys] of Object.entries(faqs)) {
  const localeIdx = content.indexOf('"' + locale + '": {');
  if (localeIdx === -1) continue;
  let pricingIdx = content.indexOf('"pricing": {', localeIdx);
  if (pricingIdx === -1) continue;
  let depth = 0;
  let i = pricingIdx + '"pricing": {'.length;
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

fs.writeFileSync(DICT_PATH, content, 'utf-8');
console.log('Added pricing FAQ keys to all locales.');
