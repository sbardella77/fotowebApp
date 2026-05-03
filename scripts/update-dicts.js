const fs = require('fs');
const path = require('path');

const DICT_PATH = path.resolve(__dirname, '../lib/i18n/dictionaries.js');
const { dictionaries } = require(DICT_PATH);

function applyRules(value, rules) {
  let result = value;
  for (const rule of rules) {
    result = result.replace(rule.from, rule.to);
  }
  return result;
}

const rules = {
  en: [
    { from: /Your rooms and photos are private/g, to: 'Your events and photos are private' },
    { from: /your rooms and photos are private/g, to: 'your events and photos are private' },
    { from: /Your rooms/g, to: 'Your events' },
    { from: /your rooms/g, to: 'your events' },
    { from: /This room has reached/g, to: 'This event has reached' },
    { from: /this room has reached/g, to: 'this event has reached' },
    { from: /This room/g, to: 'This event' },
    { from: /this room/g, to: 'this event' },
    { from: /The room you're looking for/g, to: "The event you're looking for" },
    { from: /the room you're looking for/g, to: "the event you're looking for" },
    { from: /The room/g, to: 'The event' },
    { from: /the room/g, to: 'the event' },
    { from: /One room for/g, to: 'One event for' },
    { from: /one room for/g, to: 'one event for' },
    { from: /One room/g, to: 'One event' },
    { from: /one room/g, to: 'one event' },
    { from: /A room for/g, to: 'An event for' },
    { from: /a room for/g, to: 'an event for' },
    { from: /A room/g, to: 'An event' },
    { from: /a room/g, to: 'an event' },
    { from: /Open room/g, to: 'Open event' },
    { from: /open room/g, to: 'open event' },
    { from: /Create room/g, to: 'Create event' },
    { from: /create room/g, to: 'create event' },
    { from: /Delete room/g, to: 'Delete event' },
    { from: /delete room/g, to: 'delete event' },
    { from: /Rename room/g, to: 'Rename event' },
    { from: /rename room/g, to: 'rename event' },
    { from: /Load room/g, to: 'Load event' },
    { from: /load room/g, to: 'load event' },
    { from: /Active rooms/g, to: 'Active events' },
    { from: /active rooms/g, to: 'active events' },
    { from: /Unlimited rooms/g, to: 'Unlimited events' },
    { from: /unlimited rooms/g, to: 'unlimited events' },
    { from: /Wedding room/g, to: 'Wedding event' },
    { from: /wedding room/g, to: 'wedding event' },
    { from: /Party room/g, to: 'Party event' },
    { from: /party room/g, to: 'party event' },
    { from: /Birthday room/g, to: 'Birthday event' },
    { from: /birthday room/g, to: 'birthday event' },
    { from: /Photo room/g, to: 'Photo event' },
    { from: /photo room/g, to: 'photo event' },
    { from: /Private photo room/g, to: 'Private photo event' },
    { from: /private photo room/g, to: 'private photo event' },
    { from: /Room name must be/g, to: 'Event name must be' },
    { from: /room name must be/g, to: 'event name must be' },
    { from: /Room name/g, to: 'Event name' },
    { from: /room name/g, to: 'event name' },
    { from: /Room photos/g, to: 'Event photos' },
    { from: /room photos/g, to: 'event photos' },
    { from: /Room photo limit/g, to: 'Event photo limit' },
    { from: /room photo limit/g, to: 'event photo limit' },
    { from: /Room code/g, to: 'Event code' },
    { from: /room code/g, to: 'event code' },
    { from: /Room owner/g, to: 'Event owner' },
    { from: /room owner/g, to: 'event owner' },
    { from: /Room not found/g, to: 'Event not found' },
    { from: /room not found/g, to: 'event not found' },
    { from: /Room link/g, to: 'Event link' },
    { from: /room link/g, to: 'event link' },
    { from: /Rooms you created/g, to: 'Events you created' },
    { from: /rooms you created/g, to: 'events you created' },
    { from: /\bRooms\b/g, to: 'Events' },
    { from: /\brooms\b/g, to: 'events' },
    { from: /\bRoom\b/g, to: 'Event' },
    { from: /\broom\b/g, to: 'event' },
  ],
  de: [
    { from: /Raumname/g, to: 'Eventname' },
    { from: /Raum-Besitzer/g, to: 'Event-Besitzer' },
    { from: /Raum-Code/g, to: 'Event-Code' },
    { from: /Raum-Fotos/g, to: 'Event-Fotos' },
    { from: /Raum-Link/g, to: 'Event-Link' },
    { from: /Raum-Details/g, to: 'Event-Details' },
    { from: /Deine Räume und Fotos/g, to: 'Deine Events und Fotos' },
    { from: /deine Räume und Fotos/g, to: 'deine Events und Fotos' },
    { from: /Deine Räume/g, to: 'Deine Events' },
    { from: /deine Räume/g, to: 'deine Events' },
    { from: /Dieser Raum hat/g, to: 'Dieser Event hat' },
    { from: /dieser Raum hat/g, to: 'dieser Event hat' },
    { from: /Dieser Raum/g, to: 'Dieser Event' },
    { from: /dieser Raum/g, to: 'dieser Event' },
    { from: /Der Raum, den/g, to: 'Der Event, den' },
    { from: /der Raum, den/g, to: 'der Event, den' },
    { from: /Der Raum/g, to: 'Der Event' },
    { from: /der Raum/g, to: 'der Event' },
    { from: /Ein Raum für/g, to: 'Ein Event für' },
    { from: /ein Raum für/g, to: 'ein Event für' },
    { from: /Ein Raum/g, to: 'Ein Event' },
    { from: /ein Raum/g, to: 'ein Event' },
    { from: /Raum öffnen/g, to: 'Event öffnen' },
    { from: /raum öffnen/g, to: 'event öffnen' },
    { from: /Raum erstellen/g, to: 'Event erstellen' },
    { from: /raum erstellen/g, to: 'event erstellen' },
    { from: /Raum löschen/g, to: 'Event löschen' },
    { from: /raum löschen/g, to: 'event löschen' },
    { from: /Raum umbenennen/g, to: 'Event umbenennen' },
    { from: /raum umbenennen/g, to: 'event umbenennen' },
    { from: /Raum laden/g, to: 'Event laden' },
    { from: /raum laden/g, to: 'event laden' },
    { from: /Aktive Räume/g, to: 'Aktive Events' },
    { from: /aktive Räume/g, to: 'aktive Events' },
    { from: /Unbegrenzte Räume/g, to: 'Unbegrenzte Events' },
    { from: /unbegrenzte Räume/g, to: 'unbegrenzte Events' },
    { from: /Hochzeits-Raum/g, to: 'Hochzeits-Event' },
    { from: /hochzeits-raum/g, to: 'hochzeits-event' },
    { from: /Party-Raum/g, to: 'Party-Event' },
    { from: /party-raum/g, to: 'party-event' },
    { from: /Geburtstags-Raum/g, to: 'Geburtstags-Event' },
    { from: /geburtstags-raum/g, to: 'geburtstags-event' },
    { from: /Foto-Raum/g, to: 'Foto-Event' },
    { from: /foto-raum/g, to: 'foto-event' },
    { from: /Privater Foto-Raum/g, to: 'Privater Foto-Event' },
    { from: /privater foto-raum/g, to: 'privater foto-event' },
    { from: /Raum nicht gefunden/g, to: 'Event nicht gefunden' },
    { from: /raum nicht gefunden/g, to: 'event nicht gefunden' },
    { from: /Raum-Foto-Limit/g, to: 'Event-Foto-Limit' },
    { from: /raum-foto-limit/g, to: 'event-foto-limit' },
    { from: /Räume, die/g, to: 'Events, die' },
    { from: /räume, die/g, to: 'events, die' },
    { from: /Von dir erstellte Räume/g, to: 'Von dir erstellte Events' },
    { from: /von dir erstellte Räume/g, to: 'von dir erstellte Events' },
    { from: /Räume/g, to: 'Events' },
    { from: /räume/g, to: 'events' },
    { from: /\bRaum\b/g, to: 'Event' },
    { from: /\braum\b/g, to: 'event' },
  ],
  it: [
    { from: /le tue stanze/g, to: 'i tuoi eventi' },
    { from: /Le tue stanze/g, to: 'I tuoi eventi' },
    { from: /delle stanze/g, to: 'degli eventi' },
    { from: /Delle stanze/g, to: 'Degli eventi' },
    { from: /nelle stanze/g, to: 'negli eventi' },
    { from: /Nelle stanze/g, to: 'Negli eventi' },
    { from: /questa stanza/g, to: 'questo evento' },
    { from: /Questa stanza/g, to: 'Questo evento' },
    { from: /una stanza/g, to: 'un evento' },
    { from: /Una stanza/g, to: 'Un evento' },
    { from: /la stanza/g, to: "l'evento" },
    { from: /La stanza/g, to: "L'evento" },
    { from: /della stanza/g, to: "dell'evento" },
    { from: /Della stanza/g, to: "Dell'evento" },
    { from: /nella stanza/g, to: "nell'evento" },
    { from: /Nella stanza/g, to: "Nell'evento" },
    { from: /Stanza non trovata/g, to: 'Evento non trovato' },
    { from: /stanza non trovata/g, to: 'evento non trovato' },
    { from: /Stanza creata/g, to: 'Evento creato' },
    { from: /stanza creata/g, to: 'evento creato' },
    { from: /Stanza eliminata/g, to: 'Evento eliminato' },
    { from: /stanza eliminata/g, to: 'evento eliminato' },
    { from: /Stanza rinominata/g, to: 'Evento rinominato' },
    { from: /stanza rinominata/g, to: 'evento rinominato' },
    { from: /Le tue stanze e foto/g, to: 'I tuoi eventi e le foto' },
    { from: /le tue stanze e foto/g, to: 'i tuoi eventi e le foto' },
    { from: /Nome stanza/g, to: 'Nome evento' },
    { from: /nome stanza/g, to: 'nome evento' },
    { from: /Foto stanza/g, to: 'Foto evento' },
    { from: /foto stanza/g, to: 'foto evento' },
    { from: /Codice stanza/g, to: 'Codice evento' },
    { from: /codice stanza/g, to: 'codice evento' },
    { from: /proprietario della stanza/g, to: "proprietario dell'evento" },
    { from: /Proprietario della stanza/g, to: "Proprietario dell'evento" },
    { from: /Limite foto stanza/g, to: 'Limite foto evento' },
    { from: /limite foto stanza/g, to: 'limite foto evento' },
    { from: /Link della stanza/g, to: "Link dell'evento" },
    { from: /link della stanza/g, to: "link dell'evento" },
    { from: /Stanze che/g, to: 'Eventi che' },
    { from: /stanze che/g, to: 'eventi che' },
    { from: /Stanze attive/g, to: 'Eventi attivi' },
    { from: /stanze attive/g, to: 'eventi attivi' },
    { from: /Stanze illimitate/g, to: 'Eventi illimitati' },
    { from: /stanze illimitate/g, to: 'eventi illimitati' },
    { from: /Stanza matrimonio/g, to: 'Evento matrimonio' },
    { from: /stanza matrimonio/g, to: 'evento matrimonio' },
    { from: /\bStanze\b/g, to: 'Eventi' },
    { from: /\bstanze\b/g, to: 'eventi' },
    { from: /\bStanza\b/g, to: 'Evento' },
    { from: /\bstanza\b/g, to: 'evento' },
  ],
  fr: [
    { from: /de la salle/g, to: "de l'événement" },
    { from: /De la salle/g, to: "De l'événement" },
    { from: /de votre salle/g, to: "de votre événement" },
    { from: /De votre salle/g, to: "De votre événement" },
    { from: /dans ce salle/g, to: "dans cet événement" },
    { from: /Dans ce salle/g, to: "Dans cet événement" },
    { from: /ce salle/g, to: "cet événement" },
    { from: /Ce salle/g, to: "Cet événement" },
    { from: /du salle/g, to: "de l'événement" },
    { from: /Du salle/g, to: "De l'événement" },
    { from: /le salle/g, to: "l'événement" },
    { from: /Le salle/g, to: "L'événement" },
    { from: /la salle/g, to: "l'événement" },
    { from: /La salle/g, to: "L'événement" },
    { from: /une salle/g, to: "un événement" },
    { from: /Une salle/g, to: "Un événement" },
    { from: /vos salles/g, to: 'vos événements' },
    { from: /Vos salles/g, to: 'Vos événements' },
    { from: /des salles/g, to: 'des événements' },
    { from: /Des salles/g, to: 'Des événements' },
    { from: /les salles/g, to: 'les événements' },
    { from: /Les salles/g, to: 'Les événements' },
    { from: /Salle introuvable/g, to: 'Événement introuvable' },
    { from: /salle introuvable/g, to: 'événement introuvable' },
    { from: /Salle créé/g, to: 'Événement créé' },
    { from: /salle créé/g, to: 'événement créé' },
    { from: /Salle supprimé/g, to: 'Événement supprimé' },
    { from: /salle supprimé/g, to: 'événement supprimé' },
    { from: /Salle renommé/g, to: 'Événement renommé' },
    { from: /salle renommé/g, to: 'événement renommé' },
    { from: /Vos salles et photos/g, to: 'Vos événements et photos' },
    { from: /vos salles et photos/g, to: 'vos événements et photos' },
    { from: /Nom du salle/g, to: "Nom de l'événement" },
    { from: /nom du salle/g, to: "nom de l'événement" },
    { from: /Code du salle/g, to: "Code de l'événement" },
    { from: /code du salle/g, to: "code de l'événement" },
    { from: /propriétaire du salle/g, to: "propriétaire de l'événement" },
    { from: /Propriétaire du salle/g, to: "Propriétaire de l'événement" },
    { from: /Limite de photos du salle/g, to: "Limite de photos de l'événement" },
    { from: /limite de photos du salle/g, to: "limite de photos de l'événement" },
    { from: /Lien du salle/g, to: "Lien de l'événement" },
    { from: /lien du salle/g, to: "lien de l'événement" },
    { from: /Salons que/g, to: 'Événements que' },
    { from: /salons que/g, to: 'événements que' },
    { from: /Salons actifs/g, to: 'Événements actifs' },
    { from: /salons actifs/g, to: 'événements actifs' },
    { from: /Salons illimités/g, to: 'Événements illimités' },
    { from: /salons illimités/g, to: 'événements illimités' },
    { from: /Salle de mariage/g, to: 'Événement de mariage' },
    { from: /salle de mariage/g, to: 'événement de mariage' },
    { from: /\bSalons\b/g, to: 'Événements' },
    { from: /\bsalons\b/g, to: 'événements' },
    { from: /\bSalle\b/g, to: 'Événement' },
    { from: /\bsalle\b/g, to: 'événement' },
  ],
  es: [
    { from: /de la sala/g, to: 'del evento' },
    { from: /De la sala/g, to: 'Del evento' },
    { from: /en la sala/g, to: 'en el evento' },
    { from: /En la sala/g, to: 'En el evento' },
    { from: /la sala/g, to: 'el evento' },
    { from: /La sala/g, to: 'El evento' },
    { from: /una sala/g, to: 'un evento' },
    { from: /Una sala/g, to: 'Un evento' },
    { from: /las salas/g, to: 'los eventos' },
    { from: /Las salas/g, to: 'Los eventos' },
    { from: /de las salas/g, to: 'de los eventos' },
    { from: /De las salas/g, to: 'De los eventos' },
    { from: /en las salas/g, to: 'en los eventos' },
    { from: /En las salas/g, to: 'En los eventos' },
    { from: /tus salas/g, to: 'tus eventos' },
    { from: /Tus salas/g, to: 'Tus eventos' },
    { from: /Sala no encontrada/g, to: 'Evento no encontrado' },
    { from: /sala no encontrada/g, to: 'evento no encontrado' },
    { from: /Sala creada/g, to: 'Evento creado' },
    { from: /sala creada/g, to: 'evento creado' },
    { from: /Sala eliminada/g, to: 'Evento eliminado' },
    { from: /sala eliminada/g, to: 'evento eliminado' },
    { from: /Sala renombrada/g, to: 'Evento renombrado' },
    { from: /sala renombrada/g, to: 'evento renombrado' },
    { from: /Tus salas y fotos/g, to: 'Tus eventos y fotos' },
    { from: /tus salas y fotos/g, to: 'tus eventos y fotos' },
    { from: /Nombre de la sala/g, to: 'Nombre del evento' },
    { from: /nombre de la sala/g, to: 'nombre del evento' },
    { from: /Fotos de la sala/g, to: 'Fotos del evento' },
    { from: /fotos de la sala/g, to: 'fotos del evento' },
    { from: /Código de sala/g, to: 'Código de evento' },
    { from: /código de sala/g, to: 'código de evento' },
    { from: /propietario de la sala/g, to: 'propietario del evento' },
    { from: /Propietario de la sala/g, to: 'Propietario del evento' },
    { from: /Límite de fotos de la sala/g, to: 'Límite de fotos del evento' },
    { from: /límite de fotos de la sala/g, to: 'límite de fotos del evento' },
    { from: /Enlace de la sala/g, to: 'Enlace del evento' },
    { from: /enlace de la sala/g, to: 'enlace del evento' },
    { from: /Salas que/g, to: 'Eventos que' },
    { from: /salas que/g, to: 'eventos que' },
    { from: /Salas activas/g, to: 'Eventos activos' },
    { from: /salas activas/g, to: 'eventos activos' },
    { from: /Salas ilimitadas/g, to: 'Eventos ilimitados' },
    { from: /salas ilimitadas/g, to: 'eventos ilimitados' },
    { from: /Sala de boda/g, to: 'Evento de boda' },
    { from: /sala de boda/g, to: 'evento de boda' },
    { from: /\bSalas\b/g, to: 'Eventos' },
    { from: /\bsalas\b/g, to: 'eventos' },
    { from: /\bSala\b/g, to: 'Evento' },
    { from: /\bsala\b/g, to: 'evento' },
  ],
};

const changes = [];

for (const locale of Object.keys(dictionaries)) {
  const localeRules = rules[locale];
  if (!localeRules) continue;

  for (const ns of Object.keys(dictionaries[locale])) {
    for (const key of Object.keys(dictionaries[locale][ns])) {
      const oldVal = dictionaries[locale][ns][key];
      if (typeof oldVal !== 'string') continue;
      const newVal = applyRules(oldVal, localeRules);
      if (newVal !== oldVal) {
        changes.push(`[${locale}.${ns}.${key}] "${oldVal}" -> "${newVal}"`);
        dictionaries[locale][ns][key] = newVal;
      }
    }
  }
}

console.log(`Made ${changes.length} replacements.`);

function escapeSingleQuotes(str) {
  return str.replace(/'/g, "\\'");
}

let output = `/**
 * Centralized translation dictionaries for SnapRooms.
 *
 * Namespaces:
 *   common, nav, footer, install, room, auth,
 *   dashboard, privateDelivery, photographerUpload, pricing, meta, landing,
 *   wedding, birthday, privateParty, corporate, photographers, planners, legal
 *
 * Fallback to English is handled at runtime in getDictionary().
 */

export const dictionaries = {
`;

for (const locale of Object.keys(dictionaries)) {
  output += `  ${locale}: {\n`;
  for (const ns of Object.keys(dictionaries[locale])) {
    output += `    ${ns}: {\n`;
    for (const key of Object.keys(dictionaries[locale][ns])) {
      const value = dictionaries[locale][ns][key];
      if (typeof value !== 'string') {
        output += `      ${key}: ${JSON.stringify(value)},\n`;
        continue;
      }
      const escaped = escapeSingleQuotes(value);
      const singleLine = `      ${key}: '${escaped}',`;
      if (singleLine.length <= 110) {
        output += singleLine + '\n';
      } else {
        output += `      ${key}:\n        '${escaped}',\n`;
      }
    }
    output += `    },\n`;
  }
  output += `  },\n`;
}

output += '}\n';

fs.writeFileSync(DICT_PATH, output);
console.log('Wrote updated dictionaries to', DICT_PATH);
