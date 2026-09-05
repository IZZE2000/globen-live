/**
 * Tolkar eventdatum ur brödtext.
 *
 * Slakthusen publicerar sina konserter som vanliga WordPress-inlägg. REST-fältet `date`
 * är publiceringsdatum och alltså oanvändbart — det riktiga eventdatumet står bara i
 * prosan, i formen:
 *
 *   "Band: Kallsup  Torsdag 26 november  Venue: Hus 7  Insläpp 19.00  Live från ca 20.00"
 *
 * Året anges sällan och måste då härledas. När HTML-taggarna strippats klistras orden
 * dessutom ihop ("KallsupTorsdag"), så mönstren får inte förlita sig på ordgränser.
 *
 * Arrangörerna skriver inte enhetligt. En genomgång av samtliga inlägg på slakthusen.se
 * visade att var femte konsert föll bort med bara det svenska grundformatet — förkortade
 * månader ("5 nov"), engelska datum ("15th of August") och engelska turnéplanscher är
 * vanliga. Därför tolkas både svenska och engelska månadsnamn här.
 */

import { startOfZonedDay, zonedParts, zonedTimeToUtc, ZONE } from './timezone.js';

/**
 * Månadsnamn till månadsnummer, svenska och engelska, hela och förkortade.
 * Ordningen i regexet spelar roll — längre namn måste komma före sina egna
 * förkortningar, annars matchar "nov" innan "november" hinner provas.
 */
const MONTH_NAMES = [
  ['februari', 2], ['february', 2],
  ['september', 9],
  ['november', 11],
  ['december', 12],
  ['januari', 1], ['january', 1],
  ['augusti', 8], ['august', 8],
  ['oktober', 10], ['october', 10],
  ['april', 4],
  ['march', 3], ['mars', 3],
  ['june', 6], ['juni', 6],
  ['july', 7], ['juli', 7],
  ['maj', 5], ['may', 5],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4],
  ['jun', 6], ['jul', 7], ['aug', 8], ['sep', 9],
  ['okt', 10], ['oct', 10], ['nov', 11], ['dec', 12],
];

const MONTH_TO_NUMBER = new Map(MONTH_NAMES);
const MONTH_PATTERN = MONTH_NAMES.map(([name]) => name).join('|');

const WEEKDAY_PATTERN =
  '(?:(?:mån|tis|ons|tors|fre|lör|sön)dag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)';

/**
 * Ett dagnummer måste stå fritt, inte vara en bit av ett längre tal.
 * Utan det här skyddet läses "25" ur "november 2025" som den 25:e.
 */
const DAY = '(?<!\\d)(\\d{1,2})(?!\\d)';

/** Valfritt utskrivet år direkt efter månaden. */
const YEAR = '(?:\\s*,?\\s*(20\\d{2}))?';

const ORDINAL = '(?:st|nd|rd|th|:e|:a)?';

/**
 * Mönstren provas i tur och ordning. De med veckodag först — de är mest specifika
 * och minst benägna att fastna i löptext.
 */
const DATE_PATTERNS = [
  // "Torsdag 26 november 2026" / "Saturday 15th of August 2026"
  new RegExp(`${WEEKDAY_PATTERN}\\s*${DAY}${ORDINAL}\\s*(?:of\\s*)?(${MONTH_PATTERN})${YEAR}`, 'i'),
  // "22ND OF MAY" — ordningstal utan veckodag
  new RegExp(`${DAY}${ORDINAL}\\s*of\\s*(${MONTH_PATTERN})${YEAR}`, 'i'),
  // "26 november" / "5 nov"
  new RegExp(`${DAY}${ORDINAL}\\s*(${MONTH_PATTERN})${YEAR}`, 'i'),
  // "March 21" — månaden först, engelsk ordföljd
  new RegExp(`(${MONTH_PATTERN})\\s*${DAY}${ORDINAL}${YEAR}`, 'i'),
];

/** I det sista mönstret står månaden före dagen, så grupperna byter plats. */
const MONTH_FIRST_INDEX = DATE_PATTERNS.length - 1;

const TIME = '(?<!\\d)(\\d{1,2})[.:](\\d{2})';

/** Samma, men med minuterna valfria — för spann som "kl 21-03". */
const TIME_LOOSE = '(?<!\\d)(\\d{1,2})(?:[.:](\\d{2}))?';

/**
 * Utfyllnaden mellan nyckelordet och klockslaget. Arrangörerna skriver
 * "Insläpp: 19.00", "DOORS AT 21.00", "Dörrarna öppnas kl. 18:30" och
 * "LIVE FRÅN KL 19.45" — orden varierar, men aldrig mer än en kort fras.
 * Att tillåta godtyckliga icke-siffror upp till en bestämd längd fångar dem alla
 * utan att mönstret får läsa vidare in i nästa mening.
 */
const LEAD_IN = '[^0-9]{0,18}?';

// "Live från ca 20.00", "Live från: 20.00", "LIVE FRÅN KL 19.45"
const SHOWTIME = new RegExp(`live${LEAD_IN}${TIME}`, 'i');
// "Insläpp 19.00", "DOORS AT 21.00", "Dörrarna öppnas kl. 18:30"
const DOORS = new RegExp(`(?:insl[äa]pp|d[öo]rrar|doors)${LEAD_IN}${TIME}`, 'i');

// Engelska annonser sätter nyckelordet efter tiden: "19:00 doors 20:30 showtime".
// De här måste provas före mönstren ovan, annars läser "doors" framåt och snappar
// upp speltiden i stället för insläppet.
const SHOWTIME_TRAILING = new RegExp(`${TIME}\\s*showtime`, 'i');
const DOORS_TRAILING = new RegExp(`${TIME}\\s*doors`, 'i');

/**
 * "Tider: kl 21-03" — ett spann där starttiden är det vi vill åt.
 * Etiketten måste ha kolon; bara ordet "tid" är för vanligt i löptext för att
 * vara ett tryggt ankare.
 */
const SHOWTIME_RANGE = new RegExp(`tider?\\s*:${LEAD_IN}${TIME_LOOSE}\\s*[-–]\\s*\\d`, 'i');

/**
 * Klockslaget står ofta direkt efter datumet, utan nyckelord alls:
 * "Slaktkyrkan 6 augusti 19:00". Fönstret hålls kort så att nästa tal i texten —
 * ett biljettpris, en åldersgräns — aldrig kan tas för en tid.
 */
const TIME_AFTER_DATE = new RegExp(`^[^0-9]{0,12}?${TIME}`);

/**
 * Scenerna vi känner igen. Att matcha mot en känd lista är betydligt tryggare än
 * att plocka fritext efter etiketten — vi påstår hellre ingen scen alls än fel scen.
 */
const KNOWN_VENUES = [
  [/slaktkyrkan/i, 'Slaktkyrkan'],
  [/hus\s*7/i, 'Hus 7'],
  [/kapellet/i, 'Kapellet'],
  [/f[åa]llan/i, 'Fållan'],
  [/bar\s*15/i, 'Bar15'],
  [/kvarteret/i, 'Kvarteret'],
  [/slakthuset/i, 'Slakthuset'],
];

const VENUE_LABEL = /(?:venue|lokal|plats)s?\s*:?\s*(.{0,30})/i;

/**
 * Väljer det år som gör datumet till nästa kommande förekomst.
 *
 * Jämförelsen sker mot dygnets slut, så ett event tidigare idag räknas fortfarande
 * som i år i stället för att kastas ett helt varv framåt.
 */
function inferYear(month, day, now, timeZone) {
  const year = zonedParts(now, timeZone).year;
  const endOfCandidateDay = zonedTimeToUtc(year, month, day, 23, 59, timeZone);

  return endOfCandidateDay >= startOfZonedDay(now, timeZone) ? year : year + 1;
}

function matchTime(text, ...patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const hour = Number(match[1]);
    // Minuterna saknas i spann som "kl 21-03".
    const minute = match[2] === undefined ? 0 : Number(match[2]);
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }

  return null;
}

function matchDate(text) {
  for (const [index, pattern] of DATE_PATTERNS.entries()) {
    const match = text.match(pattern);
    if (!match) continue;

    const monthFirst = index === MONTH_FIRST_INDEX;
    const day = Number(monthFirst ? match[2] : match[1]);
    const monthName = (monthFirst ? match[1] : match[2]).toLowerCase();
    const month = MONTH_TO_NUMBER.get(monthName);

    if (!month || day < 1 || day > 31) continue;

    return {
      day,
      month,
      year: match[3] ? Number(match[3]) : null,
      // Var datumet slutar, så att tiden strax efter går att leta upp.
      endIndex: match.index + match[0].length,
    };
  }

  return null;
}

/**
 * @returns {{startUtc:number, doorsUtc:number|null, timeIsDoors:boolean, timeIsGuess:boolean}|null}
 *   null när texten inte innehåller något datum alls.
 */
export function parseSwedishEventDate(text, { now = Date.now(), timeZone = ZONE } = {}) {
  if (!text) return null;

  const date = matchDate(text);
  if (!date) return null;

  const { day, month } = date;
  const year = date.year ?? inferYear(month, day, now, timeZone);

  const doors = matchTime(text, DOORS_TRAILING, DOORS);
  const showtime =
    matchTime(text, SHOWTIME_TRAILING, SHOWTIME, SHOWTIME_RANGE) ??
    // Sista utvägen: klockslaget som står omedelbart efter datumet.
    matchTime(text.slice(date.endIndex), TIME_AFTER_DATE);

  // Speltiden är vad besökaren bryr sig om. Insläppet är en rimlig andrahandsuppgift,
  // och saknas båda är 19:00 en ärligare gissning än midnatt.
  const time = showtime ?? doors ?? { hour: 19, minute: 0 };

  return {
    startUtc: zonedTimeToUtc(year, month, day, time.hour, time.minute, timeZone),
    doorsUtc: doors
      ? zonedTimeToUtc(year, month, day, doors.hour, doors.minute, timeZone)
      : null,
    timeIsDoors: !showtime && Boolean(doors),
    timeIsGuess: !showtime && !doors,
  };
}

/**
 * Scenen ur brödtexten, för de inlägg vars titel saknar "| Scen".
 * Texten ser ut som "Venue: SlaktkyrkanDatum: 4 september" när taggarna strippats.
 */
export function parseVenueFromText(text) {
  const labelled = String(text ?? '').match(VENUE_LABEL);
  if (!labelled) return null;

  for (const [pattern, name] of KNOWN_VENUES) {
    if (pattern.test(labelled[1])) return name;
  }

  return null;
}

/** Slakthusens titlar har formen "Artist | Scen". Utan avgränsare vet vi inte scenen. */
export function parseVenueFromTitle(title) {
  if (!title || !title.includes('|')) return null;

  const venue = title.split('|').pop().trim();
  return venue.length > 0 ? venue : null;
}
