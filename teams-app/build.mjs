// Baut das Teams-App-Paket: manifest.json + Icons + ZIP.
//
//   TEAMS_APP_ID=<guid> node teams-app/build.mjs
//
// Die App-ID wird nicht in eine Datei geschrieben, die im Repo landet – sie
// kommt aus der Umgebung, genau wie bei Railway. Erzeugt teams-app/dist/ und
// teams-app/dist/teams-app.zip (fertig zum Upload in Teams).

import { deflateRawSync, deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = process.env.TEAMS_APP_ID || process.argv[2];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!APP_ID || !GUID.test(APP_ID)) {
  console.error(
    'Fehlt: TEAMS_APP_ID (die Application (client) ID aus der Azure App Registration).\n' +
      'Aufruf:  TEAMS_APP_ID=<guid> node teams-app/build.mjs',
  );
  process.exit(1);
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'dist');

/* ---------- Manifest ---------- */
// id und botId sind beide die Application (client) ID – Teams verlangt das so,
// wenn Bot und App aus derselben Registrierung kommen.
const manifest = {
  $schema:
    'https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json',
  manifestVersion: '1.17',
  version: '1.0.0',
  id: APP_ID,
  // Kein `packageName`: in Manifest 1.17 entfernt, und das Schema erlaubt keine
  // unbekannten Felder (additionalProperties: false). Steht es drin, lehnt das
  // Developer Portal das ganze Paket ab ("not understood ... Office add-in").
  developer: {
    name: 'Swiss TPH',
    // Alle drei geprüft (HTTP 200 mit echtem Seiteninhalt). /privacy und /terms
    // liefern zwar auch 200, sind aber Soft-404s: sie zeigen die Startseite.
    websiteUrl: 'https://www.swisstph.ch',
    privacyUrl: 'https://www.swisstph.ch/de/datenschutz',
    // Swiss TPH hat keine eigenen Nutzungsbedingungen – das Impressum ist die
    // nächstliegende echte Seite. Bei Bedarf auf eine interne Seite ändern.
    termsOfUseUrl: 'https://www.swisstph.ch/de/impressum',
  },
  icons: { color: 'color.png', outline: 'outline.png' },
  name: { short: 'Belegerfassung', full: 'Belegerfassung' },
  description: {
    short: 'Belegfotos automatisch in strukturierte Daten umwandeln.',
    full:
      'Schicke ein Foto oder einen Scan einer Quittung als Anhang – der Bot liest ' +
      'Händler, Datum, Beträge und Steuersätze aus und antwortet mit den erfassten ' +
      'Daten. Unterstützt JPG, PNG, WebP und GIF bis 15 MB; mehrere Belege pro ' +
      'Nachricht sind möglich. Rückfragen zu einem erfassten Beleg beantwortet der ' +
      'Bot im selben Verlauf.',
  },
  accentColor: '#1F4E79',
  bots: [
    {
      botId: APP_ID,
      scopes: ['personal', 'team', 'groupChat'],
      // Ohne das kann der Nutzer im Personal Chat keine Dateien anhängen –
      // und ohne Anhang ist der Bot nutzlos.
      supportsFiles: true,
      isNotificationOnly: false,
    },
  ],
  permissions: ['identity', 'messageTeamMembers'],
  validDomains: [],
};

/* ---------- PNG-Encoder (minimal, RGBA) ---------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Pro Zeile ein Filter-Byte (0 = None) vor den Pixeldaten.
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Icons: stilisierter Beleg mit Zackenkante ---------- */
function canvas(size, bg) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) buf.set(bg, i * 4);
  return buf;
}
const px = (buf, size, x, y, c) => {
  if (x >= 0 && y >= 0 && x < size && y < size) buf.set(c, (y * size + x) * 4);
};

/** Zeichnet die Belegform; `fill` = gefüllt (Color-Icon) oder nur Kontur. */
function receipt(buf, size, { fill, stroke, bg }) {
  const w = Math.round(size * 0.46);
  const h = Math.round(size * 0.62);
  const x0 = Math.round((size - w) / 2);
  const y0 = Math.round((size - h) / 2);
  const t = Math.max(1, Math.round(size / 32)); // Strichstärke
  const zig = Math.max(2, Math.round(size / 12)); // Zackenbreite unten

  const bottomAt = x => y0 + h - (Math.abs(((x - x0) % (zig * 2)) - zig) > zig / 2 ? zig : 0);

  for (let x = x0; x < x0 + w; x++) {
    const yb = bottomAt(x);
    for (let y = y0; y <= yb; y++) {
      const edge =
        x < x0 + t || x >= x0 + w - t || y < y0 + t || y > yb - t;
      if (edge) px(buf, size, x, y, stroke);
      else if (fill) px(buf, size, x, y, fill);
    }
  }
  // Drei Textzeilen als Andeutung.
  const lines = [0.28, 0.45, 0.62];
  for (const f of lines) {
    const y = y0 + Math.round(h * f);
    const len = Math.round(w * (f === 0.62 ? 0.4 : 0.62));
    for (let x = x0 + Math.round(w * 0.19); x < x0 + Math.round(w * 0.19) + len; x++)
      for (let k = 0; k < t; k++) px(buf, size, x, y + k, fill ? bg : stroke);
  }
}

const NAVY = [0x1f, 0x4e, 0x79, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];

// color.png: 192×192, deckender Hintergrund (Teams erlaubt keine Transparenz).
const color = canvas(192, NAVY);
receipt(color, 192, { fill: WHITE, stroke: WHITE, bg: NAVY });

// outline.png: 32×32, transparent, rein weiße Kontur – so verlangt es Teams.
const outline = canvas(32, CLEAR);
receipt(outline, 32, { fill: null, stroke: WHITE, bg: CLEAR });

/* ---------- ZIP (stored + deflate, flache Struktur) ---------- */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    // deflateRaw, nicht deflate: ZIP-Methode 8 will den nackten Deflate-Stream
    // ohne zlib-Header und -Adler-Trailer. (Im PNG oben ist zlib korrekt.)
    const comp = deflateRawSync(data, { level: 9 });
    // Nur nutzen, wenn es tatsächlich kleiner ist.
    const useDeflate = comp.length < data.length;
    const payload = useDeflate ? comp : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // benötigte Version
    lh.writeUInt16LE(0, 6); // Flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // Zeit
    lh.writeUInt16LE(0x21, 12); // Datum (1980-01-01, reproduzierbar)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, payload);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // erzeugt von
    ch.writeUInt16LE(20, 6); // benötigt
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

/* ---------- Selbstvalidierung ----------
 * Regeln aus MicrosoftTeams.schema.json v1.17. Das Schema setzt
 * additionalProperties:false – ein einziges unbekanntes Feld (früher:
 * packageName) lässt das Developer Portal das ganze Paket mit der irreführenden
 * Meldung "not understood ... Office add-in package" ablehnen. Deshalb wird hier
 * gegen die Feldliste geprüft, statt sich auf den Upload zu verlassen.
 */
const TOP_LEVEL = new Set([
  '$schema', 'accentColor', 'activities', 'authorization', 'bots',
  'composeExtensions', 'configurableProperties', 'configurableTabs', 'connectors',
  'dashboardCards', 'defaultBlockUntilAdminAction', 'defaultGroupCapability',
  'defaultInstallScope', 'description', 'developer', 'devicePermissions',
  'extensions', 'graphConnector', 'icons', 'id', 'isFullScreen',
  'localizationInfo', 'manifestVersion', 'meetingExtensionDefinition', 'name',
  'permissions', 'publisherDocsUrl', 'showLoadingIndicator', 'staticTabs',
  'subscriptionOffer', 'supportedChannelTypes', 'validDomains', 'version',
  'webApplicationInfo',
]);
const BOT_FIELDS = new Set([
  'botId', 'commandLists', 'configuration', 'isNotificationOnly',
  'needsChannelSelector', 'scopes', 'supportsCalling', 'supportsFiles',
  'supportsVideo',
]);
const REQUIRED = ['manifestVersion', 'version', 'id', 'developer', 'name', 'description', 'icons', 'accentColor'];
const MAX = {
  'name.short': 30, 'name.full': 100,
  'description.short': 80, 'description.full': 4000,
};

function validate(m) {
  const errs = [];
  for (const k of Object.keys(m))
    if (!TOP_LEVEL.has(k)) errs.push(`unbekanntes Feld "${k}" (Schema erlaubt keine Zusatzfelder)`);
  for (const k of REQUIRED) if (m[k] === undefined) errs.push(`Pflichtfeld "${k}" fehlt`);
  if (m.manifestVersion !== '1.17') errs.push(`manifestVersion muss "1.17" sein, ist "${m.manifestVersion}"`);

  for (const [path, max] of Object.entries(MAX)) {
    const [a, b] = path.split('.');
    const val = m[a]?.[b];
    if (typeof val === 'string' && val.length > max)
      errs.push(`${path} ist ${val.length} Zeichen lang, erlaubt sind ${max}`);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(m.accentColor)) errs.push(`accentColor muss #RRGGBB sein, ist "${m.accentColor}"`);
  if (!/^\d+\.\d+\.\d+$/.test(m.version)) errs.push(`version muss x.y.z sein, ist "${m.version}"`);

  for (const [k, v] of Object.entries(m.developer))
    if (k.endsWith('Url') && !v.startsWith('https://')) errs.push(`developer.${k} muss https sein: ${v}`);

  for (const bot of m.bots ?? []) {
    for (const k of Object.keys(bot))
      if (!BOT_FIELDS.has(k)) errs.push(`unbekanntes Feld "bots[].${k}"`);
    if (!GUID.test(bot.botId)) errs.push(`bots[].botId ist keine GUID: ${bot.botId}`);
    // Der Bot ist ohne 'personal' im Direktchat nicht ansprechbar.
    if (!bot.scopes?.includes('personal')) errs.push(`bots[].scopes ohne "personal"`);
  }
  for (const p of m.permissions ?? [])
    if (!['identity', 'messageTeamMembers'].includes(p)) errs.push(`permissions: "${p}" ist nicht erlaubt`);

  return errs;
}

const problems = validate(manifest);
if (problems.length) {
  console.error('Manifest ungültig – nichts geschrieben:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

/* ---------- Schreiben ---------- */
const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
const colorPng = encodePng(192, 192, color);
const outlinePng = encodePng(32, 32, outline);

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'manifest.json'), manifestBuf);
await writeFile(join(OUT, 'color.png'), colorPng);
await writeFile(join(OUT, 'outline.png'), outlinePng);
await writeFile(
  join(OUT, 'teams-app.zip'),
  zip([
    ['manifest.json', manifestBuf],
    ['color.png', colorPng],
    ['outline.png', outlinePng],
  ]),
);

console.log(`Manifest gegen die Regeln von Schema 1.17 geprüft: OK`);
console.log(`teams-app/dist/teams-app.zip  (botId ${APP_ID})`);
