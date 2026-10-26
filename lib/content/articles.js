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
 */

const WEDSHOOTS_SOURCES = [
  { label: 'bodas.net/album-boda-wedshoots', href: 'https://www.bodas.net/album-boda-wedshoots' },
  { label: 'WedShoots en App Store', href: 'https://apps.apple.com/es/app/wedshoots/id660256196' },
]

export const ARTICLES = [
  {
    locale: 'es',
    slug: 'guia-fotos-invitados-boda',
    navLabel: 'Fotos de los invitados de tu boda',
    kind: 'guide',
    published: '2026-10-26',
    updated: '2026-10-26',
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
            ['Galería web con código QR (SnapRooms)', 'Sin app ni registro: se sube desde el navegador del móvil', 'Vídeos, descarga en ZIP y galería sin marca son de pago'],
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
          'Los vídeos cortos suelen ser lo más valioso: el discurso del padrino, la entrada al banquete, la pista de baile. Con SnapRooms los invitados pueden subir vídeos de hasta 60 segundos en los planes de pago, y se reproducen directamente en la galería.',
          'Pide que suban las fotos tal y como están en el carrete, sin pasarlas antes por WhatsApp, para conservar la resolución original.',
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
            'Free ({{price.free}}): un evento, galería compartida y almacenamiento durante 90 días, con la marca de SnapRooms en las descargas.',
            'Pro Event ({{price.proEvent}} por evento): sin marca de SnapRooms, descarga de la galería completa en ZIP, vídeos de los invitados y 12 meses de almacenamiento.',
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
        q: '¿Se pueden subir vídeos?',
        a: 'Sí, en los planes Pro Event y Wedding Pro los invitados pueden subir vídeos de hasta 60 segundos.',
      },
      {
        q: '¿Las fotos pierden calidad?',
        a: 'No. SnapRooms guarda cada foto en su resolución original y podéis descargarlas así, a diferencia de lo que ocurre al enviarlas por WhatsApp.',
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
    navLabel: 'Alternativa a WedShoots',
    kind: 'comparison',
    published: '2026-10-26',
    updated: '2026-10-26',
    checkedOn: '2026-10-26',
    sources: WEDSHOOTS_SOURCES,
    title: 'Alternativa a WedShoots sin descargar app — SnapRooms',
    description:
      'Comparamos WedShoots y SnapRooms para reunir las fotos de los invitados de tu boda: app o navegador, vídeos, descargas, privacidad y precio.',
    eyebrow: 'Comparativa',
    h1: 'SnapRooms o WedShoots: cuál elegir para las fotos de tu boda',
    intro: [
      'WedShoots, la app de Bodas.net, es la opción más conocida en España para que los invitados compartan las fotos de la boda. Es gratuita, está muy bien valorada y funciona bien. Su principal diferencia con SnapRooms es cómo participan los invitados: en WedShoots usan una app y un código de álbum; en SnapRooms suben desde el navegador del móvil, sin instalar nada.',
      'Esta comparativa usa la información publicada por Bodas.net y la ficha de WedShoots en App Store, consultadas el 26 de octubre de 2026.',
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
            ['Vídeos', 'Su web no menciona la subida de vídeos', 'Sí, hasta 60 segundos, en los planes de pago'],
            ['Descargar el álbum completo', 'Sí, en alta resolución', 'Sí, en ZIP con los archivos originales, en los planes de pago'],
            ['Control del álbum', 'Activar o desactivar el álbum, eliminar invitados, permitir o no descargas', 'Galería privada por enlace, fuera de Google; el organizador elimina las fotos que quiera'],
            ['Interacción', 'Me gusta y comentarios', 'Me gusta y compartir en Instagram, TikTok, Facebook o WhatsApp'],
            ['Fotógrafo profesional', 'No se menciona', 'Enlace de subida para el fotógrafo con Wedding Pro'],
          ],
        },
      },
      {
        heading: 'Cuándo tiene sentido WedShoots',
        list: {
          items: [
            'Si lo más importante es que sea totalmente gratis.',
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
            'Si queréis descargar todo en ZIP con los originales y sin marcas.',
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
        a: 'Sí, puedes crear un evento gratis. Los vídeos, la descarga en ZIP, la galería sin marca y el almacenamiento más largo están en Pro Event ({{price.proEvent}}) y Wedding Pro ({{price.weddingPro}}), con un pago único por evento.',
      },
      {
        q: '¿Los invitados necesitan descargar algo?',
        a: 'No. Abren el enlace o escanean el código QR y suben las fotos desde el navegador del móvil.',
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
]

/** Footer column heading for the guides of each locale that has any. */
export const ARTICLE_SECTION_LABEL = {
  es: 'Guías',
}

export function getArticlesForLocale(locale) {
  return ARTICLES.filter((a) => a.locale === locale)
}

export function getArticle(locale, slug) {
  return ARTICLES.find((a) => a.locale === locale && a.slug === slug) || null
}
