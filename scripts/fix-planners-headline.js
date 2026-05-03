import fs from 'fs';

const DICT_PATH = 'lib/i18n/dictionaries.js';
let content = fs.readFileSync(DICT_PATH, 'utf-8');

// Update heroHeadline1 and add heroHeadline2 for planners namespace
const updates = {
  en: { old: 'Every event. One dashboard. All the photos.', new1: 'Every event.', new2: 'One dashboard. All the photos.' },
  de: { old: 'Jedes Event. Ein Dashboard. Alle Fotos.', new1: 'Jedes Event.', new2: 'Ein Dashboard. Alle Fotos.' },
  it: { old: 'Ogni evento. Una dashboard. Tutte le foto.', new1: 'Ogni evento.', new2: 'Una dashboard. Tutte le foto.' },
  fr: { old: 'Chaque événement. Un tableau de bord. Toutes les photos.', new1: 'Chaque événement.', new2: 'Un tableau de bord. Toutes les photos.' },
  es: { old: 'Cada evento. Un panel. Todas las fotos.', new1: 'Cada evento.', new2: 'Un panel. Todas las fotos.' },
};

for (const [locale, vals] of Object.entries(updates)) {
  // Find planners namespace for this locale
  const localeIdx = content.indexOf('"' + locale + '": {');
  if (localeIdx === -1) continue;
  let nsIdx = content.indexOf('"planners": {', localeIdx);
  if (nsIdx === -1) continue;
  
  // Find heroHeadline1 within planners and update it
  const keyIdx = content.indexOf('"heroHeadline1":', nsIdx);
  if (keyIdx === -1) continue;
  
  // Replace the old value with new1
  const oldPattern = '"heroHeadline1": "' + vals.old.replace(/"/g, '\\"') + '"';
  const newValue = '"heroHeadline1": "' + vals.new1.replace(/"/g, '\\"') + '"';
  content = content.replace(oldPattern, newValue);
  
  // Add heroHeadline2 after heroHeadline1
  const insertAfter = '"heroHeadline1": "' + vals.new1.replace(/"/g, '\\"') + '"';
  const insertIdx = content.indexOf(insertAfter, nsIdx) + insertAfter.length;
  const newLine = ',\n        "heroHeadline2": "' + vals.new2.replace(/"/g, '\\"') + '"';
  content = content.slice(0, insertIdx) + newLine + content.slice(insertIdx);
}

fs.writeFileSync(DICT_PATH, content, 'utf-8');
console.log('Updated planners headline keys.');
