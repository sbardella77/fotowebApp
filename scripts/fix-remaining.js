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

const fixRules = {
  fr: [
    // French Salon -> Événement (the original FR used "Salon" not "Salle")
    { from: /vos salons/g, to: 'vos événements' },
    { from: /Vos salons/g, to: 'Vos événements' },
    { from: /des salons/g, to: 'des événements' },
    { from: /Des salons/g, to: 'Des événements' },
    { from: /les salons/g, to: 'les événements' },
    { from: /Les salons/g, to: 'Les événements' },
    { from: /de votre salon/g, to: "de votre événement" },
    { from: /De votre salon/g, to: "De votre événement" },
    { from: /dans ce salon/g, to: "dans cet événement" },
    { from: /Dans ce salon/g, to: "Dans cet événement" },
    { from: /ce salon/g, to: "cet événement" },
    { from: /Ce salon/g, to: "Cet événement" },
    { from: /du salon/g, to: "de l'événement" },
    { from: /Du salon/g, to: "De l'événement" },
    { from: /le salon/g, to: "l'événement" },
    { from: /Le salon/g, to: "L'événement" },
    { from: /la salon/g, to: "l'événement" },
    { from: /La salon/g, to: "L'événement" },
    { from: /une salon/g, to: "un événement" },
    { from: /Une salon/g, to: "Un événement" },
    { from: /du Salon/g, to: "de l'Événement" },
    { from: /le Salon/g, to: "l'Événement" },
    { from: /ce Salon/g, to: "cet Événement" },
    { from: /un Salon/g, to: "un Événement" },
    { from: /\bSalons\b/g, to: 'Événements' },
    { from: /\bsalons\b/g, to: 'événements' },
    { from: /\bSalon\b/g, to: 'Événement' },
    { from: /\bsalon\b/g, to: 'événement' },
  ],
  it: [
    // Italian gender agreement fixes
    { from: /della tua evento/g, to: "del tuo evento" },
    { from: /Della tua evento/g, to: "Del tuo evento" },
    { from: /nella tua evento/g, to: "nel tuo evento" },
    { from: /Nella tua evento/g, to: "Nel tuo evento" },
    { from: /la tua evento/g, to: "il tuo evento" },
    { from: /La tua evento/g, to: "Il tuo evento" },
    { from: /questa evento/g, to: "questo evento" },
    { from: /Questa evento/g, to: "Questo evento" },
    { from: /una evento/g, to: "un evento" },
    { from: /Una evento/g, to: "Un evento" },
    { from: /la evento/g, to: "l'evento" },
    { from: /La evento/g, to: "L'evento" },
    { from: /tua prima evento/g, to: "tuo primo evento" },
    { from: /Tua prima evento/g, to: "Tuo primo evento" },
    { from: /tua nuova evento/g, to: "tuo nuovo evento" },
    { from: /Tua nuova evento/g, to: "Tuo nuovo evento" },
    { from: /viene aggiornata/g, to: "viene aggiornato" },
    { from: /Viene aggiornata/g, to: "Viene aggiornato" },
    { from: /aggiornarla/g, to: "aggiornarlo" },
    { from: /Aggiornarla/g, to: "Aggiornarlo" },
    { from: /questa Gratis/g, to: "questo Gratis" },
    { from: /Questa Gratis/g, to: "Questo Gratis" },
    { from: /la visitano/g, to: "lo visitano" },
    { from: /La visitano/g, to: "Lo visitano" },
  ],
  es: [
    // Spanish gender agreement fixes
    { from: /Esta evento/g, to: "Este evento" },
    { from: /esta evento/g, to: "este evento" },
    { from: /esta Gratis/g, to: "este Gratis" },
    { from: /Esta Gratis/g, to: "Este Gratis" },
    { from: /tu primera evento/g, to: "tu primer evento" },
    { from: /Tu primera evento/g, to: "Tu primer evento" },
    { from: /tu nueva evento/g, to: "tu nuevo evento" },
    { from: /Tu nueva evento/g, to: "Tu nuevo evento" },
    { from: /la actualice/g, to: "lo actualice" },
    { from: /La actualice/g, to: "Lo actualice" },
    { from: /la visiten/g, to: "lo visiten" },
    { from: /La visiten/g, to: "Lo visiten" },
    { from: /se está actualizando/g, to: "se está actualizando" }, // already correct
  ],
};

const changes = [];

for (const locale of Object.keys(fixRules)) {
  const localeRules = fixRules[locale];
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

console.log(`Made ${changes.length} additional replacements.`);

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
console.log('Wrote fixed dictionaries to', DICT_PATH);
