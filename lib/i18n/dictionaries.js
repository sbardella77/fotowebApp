/**
 * Centralized translation dictionaries for SnapRooms.
 *
 * Structure: locale -> namespace -> key -> string
 * Fallback to English is handled at runtime.
 */

export const dictionaries = {
  en: {
    common: {
      createRoom: 'Create room',
      signIn: 'Sign in',
      pricing: 'Pricing',
      copy: 'Copy',
      share: 'Share',
      copied: 'Copied',
      close: 'Close',
      cancel: 'Cancel',
      continue: 'Continue',
      save: 'Save',
      delete: 'Delete',
      loading: 'Loading...',
      error: 'Something went wrong',
      tryAgain: 'Please try again',
      free: 'Free',
      pro: 'Pro',
    },
    nav: {
      forPhotographers: 'For Photographers',
      forPlanners: 'For Planners',
      createRoom: 'Create room',
      signIn: 'Sign in',
    },
    footer: {
      privacy: 'Privacy Policy',
      terms: 'Terms of Service',
      commercialLicense: 'Commercial License',
      organizerSignIn: 'Organizer sign in',
      tagline:
        'The easiest way to collect guest photos. Built with care for hosts, photographers, and event professionals.',
    },
    install: {
      title: 'Install SnapRooms',
      addToHomeScreen: 'Add to Home Screen',
      installApp: 'Install app',
      saveShortcut: 'Save shortcut',
      description:
        'Add SnapRooms to your home screen for instant access. Open rooms faster and upload photos in one tap.',
      roomDescription:
        'Save this room to your home screen to return instantly and upload photos faster.',
      iOSInstructions:
        'Tap the Share button in Safari, then scroll down and tap "Add to Home Screen".',
      desktopInstructions:
        'Look for the install icon in your browser address bar, or use the browser menu to install SnapRooms.',
      fallbackInstructions:
        'Bookmark this page or save a shortcut to your home screen for quick access.',
      dismiss: 'Not now',
      openSettings: 'How to install',
      installed: 'SnapRooms is installed',
    },
    room: {
      roomLabel: 'Room',
      photosLabel: 'photos',
      photoLabel: 'photo',
      addYourPhotos: 'Add your photos',
      uploadPhoto: 'Upload your photo',
      snapPhoto: 'Snap your photo',
      guestNamePlaceholder: 'Your name (optional)',
      noAppNeeded: 'No app. No signup. Works instantly on any phone.',
      inviteOthers: 'Invite others to share',
      shareOnWhatsApp: 'Share on WhatsApp',
      copyLink: 'Copy link',
      nativeShare: 'Share',
      showQR: 'Show QR',
      uploadSuccess: 'Upload successful',
      uploadError: 'Upload failed',
      fileRejected: 'File must be a JPEG, PNG, WebP, or GIF under 25 MB.',
      galleryTitle: 'Gallery',
      originalQuality: 'Original quality',
      downloadAvailable: 'Original-quality download is available.',
    },
    auth: {
      ownerAccess: 'Owner access',
      email: 'Email',
      password: 'Password',
      forgotPassword: 'Forgot password?',
      createFirstRoom: 'Create your first room',
      privacyPolicy: 'Privacy Policy',
    },
    pricing: {
      title: 'Pricing',
      description:
        'Simple pricing for every kind of event. Guests always upload for free. Pay per event for personal occasions, or monthly as a professional.',
    },
    meta: {
      homeTitle: 'SnapRooms — Collect Every Guest Photo in One Room',
      homeDescription:
        'Create a photo room for weddings, parties, and events. Guests upload instantly by link or QR code — no app, no signup.',
      weddingTitle: 'Wedding Photo Sharing — SnapRooms',
      weddingDescription:
        'Collect every guest photo from your wedding in one beautiful gallery. No app required — just share a link or QR code.',
      birthdayTitle: 'Birthday Photo Sharing — SnapRooms',
      birthdayDescription:
        'Gather all birthday party photos from friends and family in one place. Instant upload by link or QR code.',
      privatePartyTitle: 'Private Party Photo Sharing — SnapRooms',
      privatePartyDescription:
        'Collect photos from your private party in a secure gallery. Guests upload instantly with no app needed.',
      corporateTitle: 'Corporate Event Photo Sharing — SnapRooms',
      corporateDescription:
        'Collect photos from corporate events, conferences, and team buildings in one shared gallery.',
      photographersTitle: 'For Wedding Photographers — SnapRooms',
      photographersDescription:
        'Deliver photos privately to your clients and collect guest snapshots in one seamless workflow.',
      plannersTitle: 'For Event Planners — SnapRooms',
      plannersDescription:
        'Add private photo galleries to every event you plan. Guests upload instantly — no app required.',
      privacyTitle: 'Privacy Policy — SnapRooms',
      privacyDescription: 'How SnapRooms handles your data, photos, and privacy.',
      termsTitle: 'Terms of Service — SnapRooms',
      termsDescription: 'Terms and conditions for using SnapRooms.',
      commercialTitle: 'Commercial License — SnapRooms',
      commercialDescription: 'Commercial licensing terms for SnapRooms.',
    },
  },

  it: {
    common: {
      createRoom: 'Crea stanza',
      signIn: 'Accedi',
      pricing: 'Prezzi',
      copy: 'Copia',
      share: 'Condividi',
      copied: 'Copiato',
      close: 'Chiudi',
      cancel: 'Annulla',
      continue: 'Continua',
      save: 'Salva',
      delete: 'Elimina',
      loading: 'Caricamento...',
      error: 'Qualcosa è andato storto',
      tryAgain: 'Riprova',
      free: 'Gratis',
      pro: 'Pro',
    },
    nav: {
      forPhotographers: 'Per Fotografi',
      forPlanners: 'Per Planner',
      createRoom: 'Crea stanza',
      signIn: 'Accedi',
    },
    footer: {
      privacy: 'Informativa sulla Privacy',
      terms: 'Termini di Servizio',
      commercialLicense: 'Licenza Commerciale',
      organizerSignIn: 'Accesso organizzatore',
      tagline:
        'Il modo più semplice per raccogliere le foto degli ospiti. Creato con cura per host, fotografi e professionisti degli eventi.',
    },
    install: {
      title: 'Installa SnapRooms',
      addToHomeScreen: 'Aggiungi alla Home',
      installApp: 'Installa app',
      saveShortcut: 'Salva collegamento',
      description:
        'Aggiungi SnapRooms alla home del tuo telefono per un accesso immediato. Apri le stanze più velocemente e carica foto con un tocco.',
      roomDescription:
        'Salva questa stanza nella home del tuo telefono per tornare subito e caricare foto più velocemente.',
      iOSInstructions:
        'Tappa il pulsante Condividi in Safari, poi scorri in basso e tappa "Aggiungi alla Home".',
      desktopInstructions:
        'Cerca l\'icona di installazione nella barra degli indirizzi del browser, o usa il menu del browser per installare SnapRooms.',
      fallbackInstructions:
        'Aggiungi questa pagina ai preferiti o salva un collegamento nella home per un accesso rapido.',
      dismiss: 'Non ora',
      openSettings: 'Come installare',
      installed: 'SnapRooms è installata',
    },
    room: {
      roomLabel: 'Stanza',
      photosLabel: 'foto',
      photoLabel: 'foto',
      addYourPhotos: 'Aggiungi le tue foto',
      uploadPhoto: 'Carica la tua foto',
      snapPhoto: 'Scatta una foto',
      guestNamePlaceholder: 'Il tuo nome (opzionale)',
      noAppNeeded: 'Nessuna app. Nessuna registrazione. Funziona istantaneamente su qualsiasi telefono.',
      inviteOthers: 'Invita altri a condividere',
      shareOnWhatsApp: 'Condividi su WhatsApp',
      copyLink: 'Copia link',
      nativeShare: 'Condividi',
      showQR: 'Mostra QR',
      uploadSuccess: 'Caricamento riuscito',
      uploadError: 'Caricamento fallito',
      fileRejected: 'Il file deve essere JPEG, PNG, WebP o GIF sotto i 25 MB.',
      galleryTitle: 'Galleria',
      originalQuality: 'Qualità originale',
      downloadAvailable: 'Il download in qualità originale è disponibile.',
    },
    auth: {
      ownerAccess: 'Accesso proprietario',
      email: 'Email',
      password: 'Password',
      forgotPassword: 'Password dimenticata?',
      createFirstRoom: 'Crea la tua prima stanza',
      privacyPolicy: 'Informativa sulla Privacy',
    },
    pricing: {
      title: 'Prezzi',
      description:
        'Prezzi semplici per ogni tipo di evento. Gli ospiti caricano sempre gratis. Paga per evento per occasioni personali, o mensilmente da professionista.',
    },
    meta: {
      homeTitle: 'SnapRooms — Raccogli Ogni Foto degli Ospiti in una Stanza',
      homeDescription:
        'Crea una stanza foto per matrimoni, feste ed eventi. Gli ospiti caricano istantaneamente con link o codice QR — nessuna app, nessuna registrazione.',
      weddingTitle: 'Condivisione Foto Matrimonio — SnapRooms',
      weddingDescription:
        'Raccogli ogni foto degli ospiti del tuo matrimonio in un\'unica galleria. Nessuna app richiesta — basta condividere un link o un codice QR.',
      birthdayTitle: 'Condivisione Foto Compleanno — SnapRooms',
      birthdayDescription:
        'Raccogli tutte le foto della festa di compleanno di amici e familiari in un unico posto. Caricamento istantaneo con link o codice QR.',
      privatePartyTitle: 'Condivisione Foto Festa Privata — SnapRooms',
      privatePartyDescription:
        'Raccogli le foto della tua festa privata in una galleria sicura. Gli ospiti caricano istantaneamente senza app.',
      corporateTitle: 'Condivisione Foto Eventi Aziendali — SnapRooms',
      corporateDescription:
        'Raccogli le foto di eventi aziendali, conferenze e team building in un\'unica galleria condivisa.',
      photographersTitle: 'Per Fotografi di Matrimonio — SnapRooms',
      photographersDescription:
        'Consegna foto privatamente ai tuoi clienti e raccogli gli scatti degli ospiti in un flusso di lavoro seamless.',
      plannersTitle: 'Per Planner di Eventi — SnapRooms',
      plannersDescription:
        'Aggiungi gallerie foto private a ogni evento che pianifichi. Gli ospiti caricano istantaneamente — nessuna app richiesta.',
      privacyTitle: 'Informativa sulla Privacy — SnapRooms',
      privacyDescription: 'Come SnapRooms gestisce i tuoi dati, foto e privacy.',
      termsTitle: 'Termini di Servizio — SnapRooms',
      termsDescription: 'Termini e condizioni per l\'uso di SnapRooms.',
      commercialTitle: 'Licenza Commerciale — SnapRooms',
      commercialDescription: 'Termini di licenza commerciale per SnapRooms.',
    },
  },

  fr: {
    common: {
      createRoom: 'Créer un salon',
      signIn: 'Se connecter',
      pricing: 'Tarifs',
      copy: 'Copier',
      share: 'Partager',
      copied: 'Copié',
      close: 'Fermer',
      cancel: 'Annuler',
      continue: 'Continuer',
      save: 'Enregistrer',
      delete: 'Supprimer',
      loading: 'Chargement...',
      error: 'Quelque chose a mal tourné',
      tryAgain: 'Veuillez réessayer',
      free: 'Gratuit',
      pro: 'Pro',
    },
    nav: {
      forPhotographers: 'Pour Photographes',
      forPlanners: 'Pour Organisateurs',
      createRoom: 'Créer un salon',
      signIn: 'Se connecter',
    },
    footer: {
      privacy: 'Politique de Confidentialité',
      terms: 'Conditions d\'Utilisation',
      commercialLicense: 'Licence Commerciale',
      organizerSignIn: 'Connexion organisateur',
      tagline:
        'Le moyen le plus simple de collecter les photos des invités. Conçu avec soin pour les hôtes, photographes et professionnels de l\'événementiel.',
    },
    install: {
      title: 'Installer SnapRooms',
      addToHomeScreen: 'Ajouter à l\'écran d\'accueil',
      installApp: 'Installer l\'application',
      saveShortcut: 'Enregistrer le raccourci',
      description:
        'Ajoutez SnapRooms à votre écran d\'accueil pour un accès instantané. Ouvrez les salons plus vite et téléchargez des photos en un geste.',
      roomDescription:
        'Enregistrez ce salon sur votre écran d\'accueil pour y revenir instantanément et télécharger des photos plus rapidement.',
      iOSInstructions:
        'Appuyez sur le bouton Partager dans Safari, puis faites défiler vers le bas et appuyez sur "Ajouter à l\'écran d\'accueil".',
      desktopInstructions:
        'Recherchez l\'icône d\'installation dans la barre d\'adresse de votre navigateur, ou utilisez le menu du navigateur pour installer SnapRooms.',
      fallbackInstructions:
        'Ajoutez cette page aux favoris ou enregistrez un raccourci sur votre écran d\'accueil pour un accès rapide.',
      dismiss: 'Pas maintenant',
      openSettings: 'Comment installer',
      installed: 'SnapRooms est installé',
    },
    room: {
      roomLabel: 'Salon',
      photosLabel: 'photos',
      photoLabel: 'photo',
      addYourPhotos: 'Ajoutez vos photos',
      uploadPhoto: 'Téléchargez votre photo',
      snapPhoto: 'Prenez une photo',
      guestNamePlaceholder: 'Votre nom (facultatif)',
      noAppNeeded: 'Aucune application. Aucune inscription. Fonctionne instantanément sur n\'importe quel téléphone.',
      inviteOthers: 'Invitez d\'autres personnes à partager',
      shareOnWhatsApp: 'Partager sur WhatsApp',
      copyLink: 'Copier le lien',
      nativeShare: 'Partager',
      showQR: 'Afficher le QR',
      uploadSuccess: 'Téléchargement réussi',
      uploadError: 'Échec du téléchargement',
      fileRejected: 'Le fichier doit être JPEG, PNG, WebP ou GIF de moins de 25 Mo.',
      galleryTitle: 'Galerie',
      originalQuality: 'Qualité originale',
      downloadAvailable: 'Le téléchargement en qualité originale est disponible.',
    },
    auth: {
      ownerAccess: 'Accès propriétaire',
      email: 'Email',
      password: 'Mot de passe',
      forgotPassword: 'Mot de passe oublié ?',
      createFirstRoom: 'Créez votre premier salon',
      privacyPolicy: 'Politique de Confidentialité',
    },
    pricing: {
      title: 'Tarifs',
      description:
        'Des tarifs simples pour chaque type d\'événement. Les invités téléchargent toujours gratuitement. Payez par événement pour les occasions personnelles, ou mensuellement en tant que professionnel.',
    },
    meta: {
      homeTitle: 'SnapRooms — Collectez Chaque Photo des Invités dans un Salon',
      homeDescription:
        'Créez un salon photo pour mariages, fêtes et événements. Les invités téléchargent instantanément par lien ou code QR — aucune application, aucune inscription.',
      weddingTitle: 'Partage de Photos de Mariage — SnapRooms',
      weddingDescription:
        'Collectez chaque photo des invités de votre mariage dans une seule galerie. Aucune application requise — partagez simplement un lien ou un code QR.',
      birthdayTitle: 'Partage de Photos d\'Anniversaire — SnapRooms',
      birthdayDescription:
        'Rassemblez toutes les photos de la fête d\'anniversaire d\'amis et de famille en un seul endroit. Téléchargement instantané par lien ou code QR.',
      privatePartyTitle: 'Partage de Photos de Fête Privée — SnapRooms',
      privatePartyDescription:
        'Collectez les photos de votre fête privée dans une galerie sécurisée. Les invités téléchargent instantanément sans application.',
      corporateTitle: 'Partage de Photos d\'Événements d\'Entreprise — SnapRooms',
      corporateDescription:
        'Collectez les photos d\'événements d\'entreprise, conférences et team buildings dans une seule galerie partagée.',
      photographersTitle: 'Pour Photographes de Mariage — SnapRooms',
      photographersDescription:
        'Livrez des photos en privé à vos clients et collectez les clichés des invités dans un workflow fluide.',
      plannersTitle: 'Pour Organisateurs d\'Événements — SnapRooms',
      plannersDescription:
        'Ajoutez des galeries photo privées à chaque événement que vous planifiez. Les invités téléchargent instantanément — aucune application requise.',
      privacyTitle: 'Politique de Confidentialité — SnapRooms',
      privacyDescription: 'Comment SnapRooms gère vos données, photos et confidentialité.',
      termsTitle: 'Conditions d\'Utilisation — SnapRooms',
      termsDescription: 'Termes et conditions pour utiliser SnapRooms.',
      commercialTitle: 'Licence Commerciale — SnapRooms',
      commercialDescription: 'Termes de licence commerciale pour SnapRooms.',
    },
  },

  es: {
    common: {
      createRoom: 'Crear sala',
      signIn: 'Iniciar sesión',
      pricing: 'Precios',
      copy: 'Copiar',
      share: 'Compartir',
      copied: 'Copiado',
      close: 'Cerrar',
      cancel: 'Cancelar',
      continue: 'Continuar',
      save: 'Guardar',
      delete: 'Eliminar',
      loading: 'Cargando...',
      error: 'Algo salió mal',
      tryAgain: 'Inténtalo de nuevo',
      free: 'Gratis',
      pro: 'Pro',
    },
    nav: {
      forPhotographers: 'Para Fotógrafos',
      forPlanners: 'Para Planificadores',
      createRoom: 'Crear sala',
      signIn: 'Iniciar sesión',
    },
    footer: {
      privacy: 'Política de Privacidad',
      terms: 'Términos de Servicio',
      commercialLicense: 'Licencia Comercial',
      organizerSignIn: 'Inicio de sesión del organizador',
      tagline:
        'La forma más fácil de recopilar las fotos de los invitados. Creado con cuidado para anfitriones, fotógrafos y profesionales de eventos.',
    },
    install: {
      title: 'Instalar SnapRooms',
      addToHomeScreen: 'Añadir a la pantalla de inicio',
      installApp: 'Instalar app',
      saveShortcut: 'Guardar acceso directo',
      description:
        'Añade SnapRooms a tu pantalla de inicio para acceso instantáneo. Abre las salas más rápido y sube fotos con un toque.',
      roomDescription:
        'Guarda esta sala en tu pantalla de inicio para volver al instante y subir fotos más rápido.',
      iOSInstructions:
        'Toca el botón Compartir en Safari, luego desplázate hacia abajo y toca "Añadir a la pantalla de inicio".',
      desktopInstructions:
        'Busca el icono de instalación en la barra de direcciones de tu navegador, o usa el menú del navegador para instalar SnapRooms.',
      fallbackInstructions:
        'Guarda esta página en favoritos o añade un acceso directo a tu pantalla de inicio para acceso rápido.',
      dismiss: 'Ahora no',
      openSettings: 'Cómo instalar',
      installed: 'SnapRooms está instalado',
    },
    room: {
      roomLabel: 'Sala',
      photosLabel: 'fotos',
      photoLabel: 'foto',
      addYourPhotos: 'Añade tus fotos',
      uploadPhoto: 'Sube tu foto',
      snapPhoto: 'Haz una foto',
      guestNamePlaceholder: 'Tu nombre (opcional)',
      noAppNeeded: 'Sin app. Sin registro. Funciona instantáneamente en cualquier teléfono.',
      inviteOthers: 'Invita a otros a compartir',
      shareOnWhatsApp: 'Compartir en WhatsApp',
      copyLink: 'Copiar enlace',
      nativeShare: 'Compartir',
      showQR: 'Mostrar QR',
      uploadSuccess: 'Subida exitosa',
      uploadError: 'Error al subir',
      fileRejected: 'El archivo debe ser JPEG, PNG, WebP o GIF de menos de 25 MB.',
      galleryTitle: 'Galería',
      originalQuality: 'Calidad original',
      downloadAvailable: 'La descarga en calidad original está disponible.',
    },
    auth: {
      ownerAccess: 'Acceso del propietario',
      email: 'Correo electrónico',
      password: 'Contraseña',
      forgotPassword: '¿Olvidaste tu contraseña?',
      createFirstRoom: 'Crea tu primera sala',
      privacyPolicy: 'Política de Privacidad',
    },
    pricing: {
      title: 'Precios',
      description:
        'Precios simples para todo tipo de eventos. Los invitados siempre suben gratis. Paga por evento para ocasiones personales, o mensualmente como profesional.',
    },
    meta: {
      homeTitle: 'SnapRooms — Recopila Cada Foto de los Invitados en una Sala',
      homeDescription:
        'Crea una sala de fotos para bodas, fiestas y eventos. Los invitados suben fotos al instante con enlace o código QR — sin app, sin registro.',
      weddingTitle: 'Compartir Fotos de Boda — SnapRooms',
      weddingDescription:
        'Recopila cada foto de los invitados de tu boda en una sola galería. No se necesita app — solo comparte un enlace o código QR.',
      birthdayTitle: 'Compartir Fotos de Cumpleaños — SnapRooms',
      birthdayDescription:
        'Reúne todas las fotos de la fiesta de cumpleaños de amigos y familia en un solo lugar. Subida instantánea con enlace o código QR.',
      privatePartyTitle: 'Compartir Fotos de Fiesta Privada — SnapRooms',
      privatePartyDescription:
        'Recopila las fotos de tu fiesta privada en una galería segura. Los invitados suben al instante sin necesidad de app.',
      corporateTitle: 'Compartir Fotos de Eventos Corporativos — SnapRooms',
      corporateDescription:
        'Recopila fotos de eventos corporativos, conferencias y team buildings en una sola galería compartida.',
      photographersTitle: 'Para Fotógrafos de Bodas — SnapRooms',
      photographersDescription:
        'Entrega fotos de forma privada a tus clientes y recopila las instantáneas de los invitados en un flujo de trabajo fluido.',
      plannersTitle: 'Para Planificadores de Eventos — SnapRooms',
      plannersDescription:
        'Añade galerías de fotos privadas a cada evento que planifiques. Los invitados suben al instante — no se necesita app.',
      privacyTitle: 'Política de Privacidad — SnapRooms',
      privacyDescription: 'Cómo SnapRooms maneja tus datos, fotos y privacidad.',
      termsTitle: 'Términos de Servicio — SnapRooms',
      termsDescription: 'Términos y condiciones para usar SnapRooms.',
      commercialTitle: 'Licencia Comercial — SnapRooms',
      commercialDescription: 'Términos de licencia comercial para SnapRooms.',
    },
  },
}
