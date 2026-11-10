/**
 * Editorial pages (guides, comparisons) written for one market in its own
 * language — not translated from the English marketing pages. Each article
 * exists only in `locale`; app/[locale]/[slug]/page.js renders it, and the
 * sitemap, footer and llms.txt list it from here.
 *
 * Facts about SnapRooms plans must match the pricing page (components/
 * pricing-page.jsx); prices are {{price.*}} tokens (lib/currency.js), filled
 * in the visitor's currency when the page renders. Facts about other products cite where they were read
 * and when (`sources`, `checkedOn`), and must be re-checked before editing.
 *
 * Articles that cover the same `topic` in different locales are linked to
 * each other with hreflang, so search engines show each market its own one.
 */

const WEDSHOOTS_SOURCES = [
  { label: 'bodas.net/album-boda-wedshoots', href: 'https://www.bodas.net/album-boda-wedshoots' },
]

export const ARTICLES = [
  {
    locale: 'es',
    slug: 'guia-fotos-invitados-boda',
    topic: 'guest-photos-guide',
    navLabel: 'Fotos de los invitados de tu boda',
    kind: 'guide',
    published: '2026-10-26',
    updated: '2026-11-10',
    title: 'Cómo reunir las fotos de los invitados de tu boda — SnapRooms',
    description:
      'Guía paso a paso para recopilar las fotos y vídeos que hacen tus invitados en la boda: opciones, código QR, privacidad y cómo descargarlo todo al final.',
    eyebrow: 'Guía',
    h1: 'Cómo reunir todas las fotos de los invitados de tu boda',
    intro: [
      'En una boda los invitados hacen muchísimas fotos con el móvil: el primer baile visto desde las mesas, los abrazos en la salida de la iglesia, la barra libre a las tres de la mañana. La mayoría nunca llegan a los novios. Se quedan en carretes, en grupos de WhatsApp o en stories que desaparecen al día siguiente.',
      'Esta guía repasa las opciones que existen, sus límites reales y cómo organizarlo para que nadie tenga que acordarse de enviarte nada después.',
    ],
    sections: [
      {
        heading: 'Por qué se pierden las fotos de los invitados',
        paragraphs: [
          'Pedir a los invitados que te manden las fotos "cuando puedan" casi nunca funciona: pasan los días y solo unos pocos lo hacen. Y cuando las fotos llegan por WhatsApp, llegan comprimidas, con menos resolución de la original, mezcladas con cientos de mensajes y sin una forma sencilla de descargarlas todas juntas.',
          'Los álbumes compartidos de Google Fotos o iCloud conservan la calidad, pero para subir hace falta una cuenta de Google o un Apple ID, y siempre hay invitados que se quedan fuera. Un hashtag en Instagram solo recoge las publicaciones públicas de quien se acuerda de usarlo.',
        ],
      },
      {
        heading: 'Las opciones, una por una',
        table: {
          head: ['Opción', 'A favor', 'En contra'],
          rows: [
            ['Grupo de WhatsApp', 'Todo el mundo lo tiene', 'Comprime fotos y vídeos, mezcla mensajes y descargar todo es tedioso'],
            ['Álbum de Google Fotos o iCloud', 'Gratis y con buena calidad', 'Para subir hace falta cuenta de Google o Apple ID'],
            ['Hashtag de Instagram', 'Fácil de anunciar', 'Solo recoge publicaciones públicas y no da acceso a los originales'],
            ['App de bodas (por ejemplo, WedShoots)', 'Pensada para bodas y gratuita', 'Cada invitado tiene que descargar la app e introducir un código'],
            ['Galería web con código QR (SnapRooms)', 'Sin app ni registro: se sube desde el navegador del móvil', 'Más de 50 fotos, vídeos, descarga en ZIP y galería sin marca son de pago'],
          ],
        },
      },
      {
        heading: 'Paso a paso: cómo organizarlo con un código QR',
        list: {
          ordered: true,
          items: [
            'Crea la galería unas semanas antes de la boda y ponle vuestros nombres. Así puedes probarla tranquilamente con un par de amigos.',
            'Descarga el código QR e inclúyelo en la papelería: seating plan, minutas, tarjetas de mesa o la propia invitación.',
            'Anúncialo en el momento justo. Que el maestro de ceremonias o el DJ lo mencione después de la ceremonia y al empezar el banquete multiplica las subidas.',
            'Durante la boda los invitados escanean el código, eligen las fotos del carrete y las suben desde el navegador. La galería se actualiza al momento y cualquiera puede verla y dar "me gusta".',
            'Al día siguiente, descarga la galería completa y comparte el enlace con los invitados para que todos puedan ver las fotos de los demás.',
          ],
        },
      },
      {
        heading: 'Qué hace exactamente cada invitado',
        paragraphs: [
          'Para un invitado son unos segundos y no necesita instalar ninguna app: abre la cámara del móvil y escanea el QR, o toca el enlace que le habéis enviado por WhatsApp o en la invitación. La galería se abre en el navegador (Safari, Chrome o el que use), tanto en iPhone como en Android.',
          'No tiene que crear una cuenta ni dejar su email; si quiere, puede escribir su nombre para que sepáis quién subió cada foto. Después toca el botón de subir, elige fotos (y vídeos, si vuestro plan los incluye) del carrete y listo: aparecen en la galería para todos.',
        ],
        link: { label: 'Cómo funciona SnapRooms en una boda', path: '/wedding-photo-sharing' },
      },
      {
        heading: 'Dónde colocar el código QR',
        list: {
          items: [
            'En la mesa de bienvenida o junto al libro de firmas.',
            'En cada mesa del banquete, con una frase corta como "Sube aquí tus fotos de la boda".',
            'En el photocall, que es donde más fotos se hacen.',
            'En la invitación o en vuestra web de boda, para que los invitados lo tengan antes de llegar.',
            'En el mensaje de agradecimiento de los días siguientes, para quien no subió nada durante la fiesta.',
          ],
        },
      },
      {
        heading: 'Fotos y vídeos: qué pedir a los invitados',
        paragraphs: [
          'Los vídeos cortos suelen ser lo más valioso: el discurso del padrino, la entrada al banquete, la pista de baile. Con SnapRooms los invitados pueden subir vídeos de hasta 60 segundos y 150 MB (MP4, MOV o WebM) en los planes de pago, y se reproducen directamente en la galería. El plan gratuito solo admite fotos.',
          'Pide que suban las fotos directamente desde el carrete, no las que han recibido por WhatsApp, que ya llegan comprimidas. SnapRooms guarda cada foto tal y como sale del móvil, sin reducirla ni volver a comprimirla.',
        ],
      },
      {
        heading: 'Privacidad: quién puede ver las fotos',
        paragraphs: [
          'La galería es privada: solo entra quien tiene el enlace o el código QR, y no aparece en Google. Las fotos que se muestran a los invitados no incluyen la ubicación GPS del móvil que las hizo. Como organizadores, podéis eliminar cualquier foto desde vuestro panel.',
        ],
      },
      {
        heading: 'Cuánto cuesta',
        list: {
          items: [
            'Free ({{price.free}}): un evento con hasta 50 fotos, solo fotos, galería compartida y almacenamiento durante 90 días, con la marca de SnapRooms en las descargas.',
            'Pro Event ({{price.proEvent}} por evento): fotos sin límite, sin marca de SnapRooms, descarga de la galería completa en ZIP, vídeos de los invitados y 12 meses de almacenamiento.',
            'Wedding Pro ({{price.weddingPro}} por evento): todo lo anterior más entrega privada, enlace de subida para vuestro fotógrafo y 24 meses de almacenamiento.',
          ],
        },
        link: { label: 'Ver todos los precios', path: '/pricing' },
      },
    ],
    faq: [
      {
        q: '¿Los invitados tienen que descargar una app?',
        a: 'No. Escanean el código QR o abren el enlace y suben las fotos desde el navegador del móvil, tanto en iPhone como en Android.',
      },
      {
        q: '¿Tienen que registrarse o crear una cuenta?',
        a: 'No. Los invitados no necesitan cuenta ni dar su email para subir fotos.',
      },
      {
        q: '¿Hay un límite de fotos?',
        a: 'En el plan gratuito, 50 fotos por evento. Con Pro Event y Wedding Pro los invitados pueden subir todas las fotos que quieran. No hay límite de invitados en ningún plan.',
      },
      {
        q: '¿Se pueden subir vídeos?',
        a: 'Sí, en los planes Pro Event y Wedding Pro los invitados pueden subir vídeos de hasta 60 segundos.',
      },
      {
        q: '¿Las fotos pierden calidad?',
        a: 'Se guardan tal y como se hicieron, a resolución completa y sin volver a comprimirlas. En los planes de pago podéis descargar los originales; en el plan gratuito la descarga es en calidad estándar.',
      },
      {
        q: '¿Cuánto tiempo se guardan las fotos?',
        a: '90 días en el plan gratuito, 12 meses con Pro Event y 24 meses con Wedding Pro.',
      },
    ],
    cta: {
      title: 'Crea la galería de vuestra boda',
      desc: 'Es gratis empezar y tarda menos de un minuto. Podéis mejorar el plan cuando queráis.',
    },
    related: ['alternativa-wedshoots'],
  },
  {
    locale: 'es',
    slug: 'alternativa-wedshoots',
    topic: 'wedshoots-comparison',
    navLabel: 'Alternativa a WedShoots',
    kind: 'comparison',
    published: '2026-10-26',
    updated: '2026-11-10',
    checkedOn: '2026-11-10',
    sources: WEDSHOOTS_SOURCES,
    title: 'Alternativa a WedShoots sin descargar app — SnapRooms',
    description:
      'Comparamos WedShoots y SnapRooms para reunir las fotos de los invitados de tu boda: app o navegador, vídeos, descargas, privacidad y precio.',
    eyebrow: 'Comparativa',
    h1: 'SnapRooms o WedShoots: cuál elegir para las fotos de tu boda',
    intro: [
      'WedShoots, la app de Bodas.net, es la opción más conocida en España para que los invitados compartan las fotos de la boda. Es gratuita y no limita ni los invitados ni las fotos. Su principal diferencia con SnapRooms es cómo participan los invitados: en WedShoots usan una app y un código de álbum; en SnapRooms suben desde el navegador del móvil, sin instalar nada.',
      'Esta comparativa usa la información que Bodas.net publica sobre WedShoots, consultada el 10 de noviembre de 2026. Precios y funciones pueden cambiar: comprobadlos en su web antes de decidir.',
    ],
    sections: [
      {
        heading: 'Comparativa rápida',
        table: {
          head: ['', 'WedShoots', 'SnapRooms'],
          rows: [
            ['Cómo suben los invitados', 'Con la app de WedShoots (iOS y Android) y el código o QR del álbum', 'Desde el navegador del móvil, con enlace o código QR, sin app'],
            ['Registro de los invitados', 'Acceden con el código del álbum', 'No necesitan cuenta ni email'],
            ['Precio', 'Gratis', 'Gratis para un evento; Pro Event {{price.proEvent}} y Wedding Pro {{price.weddingPro}} por evento'],
            ['Límite de invitados y fotos', 'Sin límite de participantes ni de fotos', 'Invitados sin límite; 50 fotos en el plan gratuito y sin límite en los de pago'],
            ['Vídeos', 'Su web no menciona la subida de vídeos', 'Sí, hasta 60 segundos, en los planes de pago'],
            ['Descargar el álbum completo', 'Sí, en alta resolución', 'Sí, en ZIP, en los planes de pago'],
            ['Control del álbum', 'Activar o desactivar el álbum, eliminar invitados, permitir o no descargas', 'Galería privada por enlace, fuera de Google; el organizador elimina las fotos que quiera'],
            ['Interacción', 'Me gusta y comentarios', 'Me gusta y compartir en Instagram, TikTok, Facebook o WhatsApp'],
            ['Fotógrafo profesional', 'No se menciona', 'Enlace de subida para el fotógrafo con Wedding Pro'],
          ],
        },
      },
      {
        heading: 'Cómo suben las fotos los invitados en cada caso',
        paragraphs: [
          'Con WedShoots, los novios crean el álbum y reciben un código. Lo comparten por email, WhatsApp, con un QR o en las invitaciones, y cada invitado descarga la app de WedShoots en su móvil y entra en el álbum con ese código para subir sus fotos.',
          'Con SnapRooms, cada invitado escanea el QR o toca el enlace y la galería se abre en el navegador del móvil, en iPhone o Android. No instala nada, no crea cuenta y el nombre es opcional: elige las fotos del carrete, las sube y aparecen en la galería al momento.',
        ],
        link: { label: 'Guía paso a paso para reunir las fotos con un QR', path: '/guia-fotos-invitados-boda' },
      },
      {
        heading: 'Qué incluye cada plan de SnapRooms',
        table: {
          head: ['', 'Free', 'Pro Event', 'Wedding Pro'],
          rows: [
            ['Precio por evento', '{{price.free}}', '{{price.proEvent}}', '{{price.weddingPro}}'],
            ['Fotos de los invitados', 'Hasta 50', 'Sin límite', 'Sin límite'],
            ['Vídeos de hasta 60 s', 'No', 'Sí', 'Sí'],
            ['Descarga de la galería en ZIP', 'No', 'Sí', 'Sí'],
            ['Marca de SnapRooms en las descargas', 'Sí', 'No', 'No'],
            ['Entrega privada y enlace para el fotógrafo', 'No', 'No', 'Sí'],
            ['Almacenamiento', '90 días', '12 meses', '24 meses'],
          ],
        },
        link: { label: 'Ver todos los precios', path: '/pricing' },
      },
      {
        heading: 'Cuándo tiene sentido WedShoots',
        list: {
          items: [
            'Si lo más importante es que sea totalmente gratis, aunque se suban cientos de fotos.',
            'Si ya usáis Bodas.net para organizar la boda y queréis tenerlo todo en el mismo sitio.',
            'Si sabéis que vuestros invitados no tendrán problema en descargar una app el día de la boda.',
          ],
        },
      },
      {
        heading: 'Cuándo tiene más sentido SnapRooms',
        list: {
          items: [
            'Si tenéis invitados mayores, de otros países o poco amigos de instalar apps: con el navegador basta.',
            'Si queréis recoger también los vídeos de la fiesta, no solo fotos.',
            'Si queréis descargar toda la galería en un ZIP, sin la marca de SnapRooms.',
            'Si vuestro fotógrafo va a subir sus fotos a la misma galería.',
          ],
        },
      },
      {
        heading: 'La diferencia que más se nota el día de la boda',
        paragraphs: [
          'Cada paso que se pide a un invitado hace que algunos no lo den. Descargar una app, esperar a que se instale y escribir un código lleva un par de minutos; abrir la cámara, escanear un QR y elegir fotos del carrete lleva unos segundos. En una boda con cobertura irregular o con invitados que no se manejan bien con el móvil, esa diferencia se traduce en más fotos subidas.',
        ],
      },
    ],
    faq: [
      {
        q: '¿SnapRooms es gratis?',
        a: 'Sí, puedes crear un evento gratis con hasta 50 fotos. Las fotos sin límite, los vídeos, la descarga en ZIP, la galería sin marca y el almacenamiento más largo están en Pro Event ({{price.proEvent}}) y Wedding Pro ({{price.weddingPro}}), con un pago único por evento.',
      },
      {
        q: '¿Los invitados necesitan descargar algo?',
        a: 'No. Abren el enlace o escanean el código QR y suben las fotos desde el navegador del móvil, sin instalar ninguna app ni crear una cuenta.',
      },
      {
        q: '¿Puedo usar WedShoots y SnapRooms a la vez?',
        a: 'Sí, pero dividir las fotos entre dos sitios confunde a los invitados. Es mejor elegir uno y anunciarlo bien.',
      },
      {
        q: '¿Funciona con invitados de otros países?',
        a: 'Sí. SnapRooms está disponible en español, inglés, alemán, italiano, francés y portugués.',
      },
    ],
    cta: {
      title: 'Prueba SnapRooms gratis',
      desc: 'Crea la galería de tu boda en un minuto y pruébala con un par de amigos antes del gran día.',
    },
    related: ['guia-fotos-invitados-boda'],
    disclaimer:
      'WedShoots y Bodas.net son marcas de sus respectivos titulares. SnapRooms no tiene relación con ellos.',
  },
  {
    locale: 'it',
    slug: 'guida-foto-invitati-matrimonio',
    topic: 'guest-photos-guide',
    navLabel: 'Foto degli invitati al matrimonio',
    kind: 'guide',
    published: '2026-11-02',
    updated: '2026-11-10',
    title: 'Come raccogliere le foto degli invitati al matrimonio — SnapRooms',
    description:
      'Guida pratica per raccogliere foto e video che gli invitati scattano al matrimonio: le alternative, il QR code, la privacy e come scaricare tutto alla fine.',
    eyebrow: 'Guida',
    h1: 'Come raccogliere tutte le foto degli invitati al tuo matrimonio',
    intro: [
      'Al matrimonio gli invitati scattano centinaia di foto con il telefono: l\'uscita dalla chiesa o dal comune, il taglio della torta, il lancio del bouquet, la pista da ballo a fine serata. La maggior parte non arriva mai agli sposi. Resta nei rullini, nelle chat di WhatsApp o nelle storie che spariscono dopo un giorno.',
      'Questa guida mette a confronto le soluzioni possibili, con i loro limiti reali, e spiega come organizzarsi perché nessuno debba ricordarsi di mandarvi qualcosa dopo.',
    ],
    sections: [
      {
        heading: 'Perché le foto degli invitati vanno perse',
        paragraphs: [
          'Chiedere agli invitati di mandarvi le foto "quando hanno tempo" non funziona quasi mai: passano i giorni e solo pochi lo fanno. E quando le foto arrivano su WhatsApp sono compresse, a risoluzione più bassa dell\'originale, sparse tra centinaia di messaggi e senza un modo comodo per scaricarle tutte insieme.',
          'Gli album condivisi di Google Foto o iCloud mantengono la qualità, ma per caricare serve un account Google o un ID Apple, e qualche invitato resta sempre fuori. Un hashtag su Instagram raccoglie solo i post pubblici di chi si ricorda di usarlo.',
        ],
      },
      {
        heading: 'Le soluzioni a confronto',
        table: {
          head: ['Soluzione', 'Pro', 'Contro'],
          rows: [
            ['Gruppo WhatsApp', 'Ce l\'hanno tutti', 'Comprime foto e video, mescola i messaggi, scaricare tutto è lungo'],
            ['Album Google Foto o iCloud', 'Gratis e in buona qualità', 'Per caricare serve un account Google o un ID Apple'],
            ['Hashtag su Instagram', 'Facile da comunicare', 'Raccoglie solo i post pubblici e non dà accesso agli originali'],
            ['App per matrimoni (per esempio WedShoots)', 'Pensata per le nozze e gratuita', 'Ogni invitato deve scaricare l\'app e inserire il codice dell\'album'],
            ['Galleria web con QR code (SnapRooms)', 'Niente app né registrazione: si carica dal browser del telefono', 'Più di 50 foto, video, download ZIP e galleria senza marchio sono a pagamento'],
          ],
        },
      },
      {
        heading: 'Passo per passo: come organizzarsi con un QR code',
        list: {
          ordered: true,
          items: [
            'Create la galleria qualche settimana prima del matrimonio e dategli i vostri nomi. Così potete provarla con calma insieme a un paio di amici.',
            'Scaricate il QR code e mettetelo sulla carta del matrimonio: tableau de mariage, menu, segnaposto o direttamente sulle partecipazioni.',
            'Annunciatelo al momento giusto. Se il testimone o il DJ lo ricordano dopo la cerimonia e all\'inizio del ricevimento, i caricamenti si moltiplicano.',
            'Durante la festa gli invitati inquadrano il codice, scelgono le foto dal rullino e le caricano dal browser. La galleria si aggiorna subito e tutti possono guardarla e mettere "mi piace".',
            'Il giorno dopo scaricate la galleria completa e mandate il link agli invitati, così ognuno può vedere le foto degli altri.',
          ],
        },
      },
      {
        heading: 'Cosa fa esattamente ogni invitato',
        paragraphs: [
          'Per un invitato bastano pochi secondi e non deve installare nessuna app: apre la fotocamera del telefono e inquadra il QR, oppure tocca il link che gli avete mandato su WhatsApp o sulla partecipazione. La galleria si apre nel browser (Safari, Chrome o quello che usa), sia su iPhone sia su Android.',
          'Non deve creare un account né lasciare la sua email; se vuole, può scrivere il suo nome così sapete chi ha caricato ogni foto. Poi tocca il pulsante per caricare, sceglie le foto (e i video, se il vostro piano li include) dal rullino ed è fatto: compaiono nella galleria per tutti.',
        ],
        link: { label: 'Come funziona SnapRooms al matrimonio', path: '/wedding-photo-sharing' },
      },
      {
        heading: 'Dove mettere il QR code',
        list: {
          items: [
            'All\'ingresso del ricevimento o accanto al guestbook.',
            'Su ogni tavolo, con una frase breve come "Carica qui le tue foto del matrimonio".',
            'Vicino al photobooth o all\'angolo foto, dove si scatta di più.',
            'Sulle partecipazioni o sul sito del matrimonio, così gli invitati lo hanno già prima di arrivare.',
            'Nel messaggio di ringraziamento dei giorni successivi, per chi non ha caricato nulla durante la festa.',
          ],
        },
      },
      {
        heading: 'Foto e video: cosa chiedere agli invitati',
        paragraphs: [
          'I video brevi sono spesso la parte più preziosa: il discorso dei testimoni, l\'ingresso degli sposi in sala, il primo ballo. Con SnapRooms gli invitati possono caricare video fino a 60 secondi e 150 MB (MP4, MOV o WebM) nei piani a pagamento, e si guardano direttamente nella galleria. Il piano gratuito accetta solo foto.',
          'Chiedete di caricare le foto direttamente dal rullino, non quelle ricevute su WhatsApp, che arrivano già compresse. SnapRooms conserva ogni foto così come esce dal telefono, senza ridurla né ricomprimerla.',
        ],
      },
      {
        heading: 'Privacy: chi può vedere le foto',
        paragraphs: [
          'La galleria è privata: entra solo chi ha il link o il QR code, e non compare su Google. Le foto mostrate agli invitati non contengono la posizione GPS del telefono che le ha scattate. Come sposi potete eliminare qualsiasi foto dal vostro pannello.',
        ],
      },
      {
        heading: 'Quanto costa',
        list: {
          items: [
            'Free ({{price.free}}): un evento con al massimo 50 foto, solo foto, galleria condivisa e conservazione per 90 giorni, con il marchio SnapRooms sui download.',
            'Pro Event ({{price.proEvent}} a evento): foto senza limiti, senza marchio SnapRooms, download della galleria completa in ZIP, video degli invitati e 12 mesi di conservazione.',
            'Wedding Pro ({{price.weddingPro}} a evento): tutto quello che c\'è sopra più consegna privata, link di caricamento per il vostro fotografo e 24 mesi di conservazione.',
          ],
        },
        link: { label: 'Vedi tutti i prezzi', path: '/pricing' },
      },
    ],
    faq: [
      {
        q: 'Gli invitati devono scaricare un\'app?',
        a: 'No. Inquadrano il QR code o aprono il link e caricano le foto dal browser del telefono, sia su iPhone sia su Android.',
      },
      {
        q: 'Devono registrarsi o creare un account?',
        a: 'No. Gli invitati non hanno bisogno di un account né di lasciare la loro email per caricare foto.',
      },
      {
        q: 'C\'è un limite di foto?',
        a: 'Con il piano gratuito, 50 foto per evento. Con Pro Event e Wedding Pro gli invitati possono caricare tutte le foto che vogliono. In nessun piano c\'è un limite di invitati.',
      },
      {
        q: 'Si possono caricare video?',
        a: 'Sì, con Pro Event e Wedding Pro gli invitati possono caricare video fino a 60 secondi.',
      },
      {
        q: 'Le foto perdono qualità?',
        a: 'Restano come sono state scattate, a risoluzione piena e senza nuova compressione. Con i piani a pagamento potete scaricare gli originali; con il piano gratuito il download è in qualità standard.',
      },
      {
        q: 'Per quanto tempo restano le foto?',
        a: '90 giorni con il piano gratuito, 12 mesi con Pro Event e 24 mesi con Wedding Pro.',
      },
    ],
    cta: {
      title: 'Crea la galleria del vostro matrimonio',
      desc: 'Iniziare è gratis e richiede meno di un minuto. Potete passare a un piano superiore quando volete.',
    },
    related: ['alternativa-wedshoots'],
  },
  {
    locale: 'it',
    slug: 'alternativa-wedshoots',
    topic: 'wedshoots-comparison',
    navLabel: 'Alternativa a WedShoots',
    kind: 'comparison',
    published: '2026-11-02',
    updated: '2026-11-10',
    checkedOn: '2026-11-10',
    sources: [
      { label: 'matrimonio.com/album-matrimonio-wedshoots', href: 'https://www.matrimonio.com/album-matrimonio-wedshoots' },
    ],
    title: 'Alternativa a WedShoots senza scaricare app — SnapRooms',
    description:
      'Confronto tra WedShoots e SnapRooms per raccogliere le foto degli invitati al matrimonio: app o browser, video, download, privacy e prezzo.',
    eyebrow: 'Confronto',
    h1: 'SnapRooms o WedShoots: quale scegliere per le foto del tuo matrimonio',
    intro: [
      'WedShoots, l\'app di Matrimonio.com, è la soluzione più conosciuta in Italia per far condividere agli invitati le foto del matrimonio. È gratuita e senza limiti di partecipanti. La differenza principale con SnapRooms è come partecipano gli invitati: con WedShoots devono scaricare l\'app e inserire il codice dell\'album; con SnapRooms caricano dal browser del telefono, senza installare nulla.',
      'Questo confronto usa le informazioni pubblicate da Matrimonio.com sulla pagina di WedShoots, consultata il 10 novembre 2026. Prezzi e funzioni possono cambiare: verificateli sul loro sito prima di decidere.',
    ],
    sections: [
      {
        heading: 'Confronto rapido',
        table: {
          head: ['', 'WedShoots', 'SnapRooms'],
          rows: [
            ['Come caricano gli invitati', 'Con l\'app WedShoots (iOS e Android) e il codice o QR dell\'album', 'Dal browser del telefono, con link o QR code, senza app'],
            ['Registrazione degli invitati', 'Entrano con il codice dell\'album', 'Non serve account né email'],
            ['Prezzo', 'Gratis', 'Gratis per un evento; Pro Event {{price.proEvent}} e Wedding Pro {{price.weddingPro}} a evento'],
            ['Limite di invitati e foto', 'Nessun limite di partecipanti né di foto', 'Invitati senza limiti; 50 foto con il piano gratuito, senza limiti con quelli a pagamento'],
            ['Video', 'La pagina di WedShoots non parla di caricamento video', 'Sì, fino a 60 secondi, nei piani a pagamento'],
            ['Scaricare l\'album completo', 'Sì, in alta definizione, tutte o solo le foto selezionate', 'Sì, in ZIP, nei piani a pagamento'],
            ['Controllo dell\'album', 'Attivare o disattivare l\'album, permettere download e condivisione, bloccare invitati', 'Galleria privata via link, fuori da Google; gli sposi eliminano le foto che vogliono'],
            ['Interazione', 'Mi piace e commenti', 'Mi piace e condivisione su Instagram, TikTok, Facebook o WhatsApp'],
            ['Fotografo professionista', 'Non menzionato', 'Link di caricamento per il fotografo con Wedding Pro'],
          ],
        },
      },
      {
        heading: 'Come caricano le foto gli invitati, nei due casi',
        paragraphs: [
          'Con WedShoots gli sposi creano l\'album e ricevono un codice. Lo condividono via email, WhatsApp, con un QR o sulle partecipazioni, e ogni invitato scarica l\'app WedShoots sul telefono ed entra nell\'album con quel codice per pubblicare le sue foto.',
          'Con SnapRooms ogni invitato inquadra il QR o tocca il link e la galleria si apre nel browser del telefono, su iPhone o Android. Non installa nulla, non crea account e il nome è facoltativo: sceglie le foto dal rullino, le carica e compaiono subito nella galleria.',
        ],
        link: { label: 'Guida passo per passo per raccogliere le foto con un QR', path: '/guida-foto-invitati-matrimonio' },
      },
      {
        heading: 'Cosa include ogni piano SnapRooms',
        table: {
          head: ['', 'Free', 'Pro Event', 'Wedding Pro'],
          rows: [
            ['Prezzo a evento', '{{price.free}}', '{{price.proEvent}}', '{{price.weddingPro}}'],
            ['Foto degli invitati', 'Fino a 50', 'Senza limiti', 'Senza limiti'],
            ['Video fino a 60 s', 'No', 'Sì', 'Sì'],
            ['Download della galleria in ZIP', 'No', 'Sì', 'Sì'],
            ['Marchio SnapRooms sui download', 'Sì', 'No', 'No'],
            ['Consegna privata e link per il fotografo', 'No', 'No', 'Sì'],
            ['Conservazione', '90 giorni', '12 mesi', '24 mesi'],
          ],
        },
        link: { label: 'Vedi tutti i prezzi', path: '/pricing' },
      },
      {
        heading: 'Quando ha senso WedShoots',
        list: {
          items: [
            'Se la cosa più importante è che sia completamente gratis, anche con centinaia di foto.',
            'Se usate già Matrimonio.com per organizzare le nozze e volete tenere tutto nello stesso posto.',
            'Se sapete che i vostri invitati scaricheranno volentieri un\'app il giorno del matrimonio.',
          ],
        },
      },
      {
        heading: 'Quando ha più senso SnapRooms',
        list: {
          items: [
            'Se avete invitati anziani, stranieri o poco abituati a installare app: basta il browser.',
            'Se volete raccogliere anche i video della festa, non solo le foto.',
            'Se volete scaricare tutta la galleria in un file ZIP, senza il marchio SnapRooms.',
            'Se il vostro fotografo caricherà i suoi scatti nella stessa galleria.',
          ],
        },
      },
      {
        heading: 'La differenza che si nota il giorno del matrimonio',
        paragraphs: [
          'Ogni passaggio in più chiesto a un invitato fa sì che qualcuno non lo faccia. Scaricare un\'app, aspettare che si installi e digitare un codice richiede un paio di minuti; aprire la fotocamera, inquadrare un QR e scegliere le foto dal rullino richiede pochi secondi. In una location di campagna con poco campo, o con invitati che non usano molto il telefono, questa differenza si traduce in più foto caricate.',
        ],
      },
    ],
    faq: [
      {
        q: 'SnapRooms è gratis?',
        a: 'Sì, puoi creare un evento gratis con al massimo 50 foto. Foto senza limiti, video, download ZIP, galleria senza marchio e conservazione più lunga sono inclusi in Pro Event ({{price.proEvent}}) e Wedding Pro ({{price.weddingPro}}), con un pagamento unico a evento.',
      },
      {
        q: 'Gli invitati devono scaricare qualcosa?',
        a: 'No. Aprono il link o inquadrano il QR code e caricano le foto dal browser del telefono, senza installare app né creare un account.',
      },
      {
        q: 'Posso usare WedShoots e SnapRooms insieme?',
        a: 'Sì, ma dividere le foto tra due posti confonde gli invitati. Meglio sceglierne uno e comunicarlo bene.',
      },
      {
        q: 'Funziona con invitati stranieri?',
        a: 'Sì. SnapRooms è disponibile in italiano, inglese, tedesco, francese, spagnolo e portoghese.',
      },
    ],
    cta: {
      title: 'Prova SnapRooms gratis',
      desc: 'Crea la galleria del tuo matrimonio in un minuto e provala con un paio di amici prima del grande giorno.',
    },
    related: ['guida-foto-invitati-matrimonio'],
    disclaimer:
      'WedShoots e Matrimonio.com sono marchi dei rispettivi titolari. SnapRooms non ha alcun legame con loro.',
  },
]

/**
 * Fixed labels of the article page, one entry per locale that has articles: a
 * missing one renders empty headings and text-less CTA links.
 */
export const ARTICLE_PAGE_LABELS = {
  es: {
    date: 'Actualizado el',
    faq: 'Preguntas frecuentes',
    sources: 'Fuentes',
    checkedOn: 'consultadas el',
    related: 'Sigue leyendo',
    start: 'Crear evento gratis',
    pricing: 'Ver precios',
  },
  it: {
    date: 'Aggiornato il',
    faq: 'Domande frequenti',
    sources: 'Fonti',
    checkedOn: 'consultate il',
    related: 'Continua a leggere',
    start: 'Crea un evento gratis',
    pricing: 'Vedi i prezzi',
  },
}

/** Footer column heading for the guides of each locale that has any. */
export const ARTICLE_SECTION_LABEL = {
  es: 'Guías',
  it: 'Guide',
}

export function getArticlesForLocale(locale) {
  return ARTICLES.filter((a) => a.locale === locale)
}

/** hreflang map ({ locale: path }) of the articles sharing this one's topic, itself included. */
export function getArticleAlternates(article) {
  return Object.fromEntries(
    ARTICLES.filter((a) => a.topic === article.topic).map((a) => [a.locale, `/${a.locale}/${a.slug}`]),
  )
}

export function getArticle(locale, slug) {
  return ARTICLES.find((a) => a.locale === locale && a.slug === slug) || null
}
