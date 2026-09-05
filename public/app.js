/**
 * Gränssnittet.
 *
 * Statuslogiken importeras från samma moduler som servern använder, så "pågår nu"
 * beräknas på ett enda ställe. Servern serverar /src/ just för det.
 *
 * Två takter: statusen räknas om var 30:e sekund lokalt (billigt, ingen nätverkstrafik),
 * medan ny data hämtas var tionde minut.
 */

// Relativt till den här filens URL, aldrig rotabsolut: sidan kan ligga under en
// katalog på en delad domän, och då finns ingen /src/ på roten att peka mot.
import { STATUS, buildTodayView } from '../src/normalize.js';
import { formatTime, zonedDateKey } from '../src/timezone.js';

const RESTATUS_INTERVAL_MS = 30_000;
const REFETCH_INTERVAL_MS = 10 * 60_000;

const ACCENTS = {
  'avicii-arena': 'var(--avicii)',
  '3arena': 'var(--arena3)',
  hovet: 'var(--hovet)',
  annexet: 'var(--annexet)',
  // Accenten betyder plats, inte källa — och RA:s scener ligger i Slakthusområdet.
  slakthusen: 'var(--slakthuset)',
  'resident-advisor': 'var(--slakthuset)',
};

const dom = {
  headline: document.getElementById('headline'),
  content: document.getElementById('content'),
  date: document.getElementById('today-date'),
  clock: document.getElementById('clock'),
  sources: document.getElementById('sources'),
};

let state = { events: [], sources: [], stale: false, staleReason: null, error: null };

/** Vilken källa som är utfälld i källhälsan. Överlever omritningarna var 30:e sekund. */
let expandedSourceId = null;

/* ---------- Formatering ---------- */

const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Stockholm',
});

/** Kompakt variant för de utfällda källistorna: "tors 3 sep". */
const listDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Stockholm',
});

/** Samma, men med årtal — arenorna släpper biljetter långt in på nästa år. */
const listDateWithYearFormatter = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});

const yearFormatter = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});

/**
 * "tors 3 sep." räcker inom innevarande år. Sträcker sig listan in i nästa år
 * blir samma format tvetydigt, så då skrivs årtalet ut.
 */
function formatListDate(startUtc, now) {
  const sameYear = yearFormatter.format(new Date(startUtc)) === yearFormatter.format(new Date(now));
  const formatter = sameYear ? listDateFormatter : listDateWithYearFormatter;

  return formatter.format(new Date(startUtc));
}

function formatCountdown(minutes) {
  if (minutes < 1) return 'strax';
  if (minutes < 60) return `om ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `om ${hours} h` : `om ${hours} h ${rest} min`;
}

function formatAge(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'nyss';
  if (minutes < 60) return `för ${minutes} min sedan`;
  return `för ${Math.floor(minutes / 60)} h sedan`;
}

/* ---------- Byggstenar ---------- */

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function badgeFor(event) {
  if (event.status === STATUS.NOW) {
    const badge = element('span', 'badge badge--live');
    badge.append(element('span', 'pulse'), document.createTextNode('Pågår nu'));
    return badge;
  }

  if (event.status === STATUS.SOON) {
    return element('span', 'badge badge--soon', `Börjar ${formatCountdown(event.minutesUntilStart)}`);
  }

  return null;
}

function renderCard(event) {
  const card = element('a', 'card');
  card.href = event.url ?? '#';
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.style.setProperty('--accent', ACCENTS[event.sourceId] ?? 'var(--line)');

  if (event.status === STATUS.NOW) card.classList.add('card--live');
  if (event.status === STATUS.DONE) card.classList.add('card--done');

  const top = element('div', 'card__top');
  top.append(element('span', 'card__time', formatTime(event.startUtc)));

  const badge = badgeFor(event);
  if (badge) top.append(badge);
  card.append(top);

  const titleBlock = element('div');
  titleBlock.append(element('h3', 'card__title', event.title));
  if (event.subtitle) titleBlock.append(element('p', 'card__subtitle', event.subtitle));
  card.append(titleBlock);

  const foot = element('div', 'card__foot');
  foot.append(element('span', 'venue', event.venue));

  // Resident Advisor publicerar riktiga sluttider; övriga källor gör det inte.
  // Skillnaden ska synas — en gissning får aldrig se ut som ett faktum.
  if (event.status === STATUS.NOW) {
    foot.append(
      element(
        'span',
        'meta',
        event.durationIsEstimated
          ? `beräknas hålla på till ~${formatTime(event.endUtc)}`
          : `håller på till ${formatTime(event.endUtc)}`,
      ),
    );
  } else if (event.timeIsDoors) {
    foot.append(element('span', 'meta', 'insläppstid'));
  } else if (event.timeIsGuess) {
    foot.append(element('span', 'meta', 'tid ej angiven'));
  }

  card.append(foot);
  return card;
}

function renderSection(label, events) {
  const section = element('section', 'section');

  const heading = element('h2', 'section__heading');
  heading.append(element('span', null, `${label} · ${events.length}`), element('span', 'section__rule'));
  section.append(heading);

  const grid = element('div', 'grid');
  for (const event of events) grid.append(renderCard(event));
  section.append(grid);

  return section;
}

/* ---------- Vyer ---------- */

function renderHeadline(view) {
  const liveCount = view.live.length;

  if (liveCount > 0) {
    dom.headline.replaceChildren(
      document.createTextNode(liveCount === 1 ? 'Just nu pågår ' : 'Just nu pågår '),
      element('em', null, liveCount === 1 ? 'ett evenemang' : `${liveCount} evenemang`),
      document.createTextNode(' i kvarteret.'),
    );
    return;
  }

  if (view.upcoming.length > 0) {
    const next = view.upcoming[0];
    dom.headline.textContent =
      `Inget pågår just nu. Näst på tur är ${next.title} på ${next.venue}, ${formatCountdown(next.minutesUntilStart)}.`;
    return;
  }

  dom.headline.textContent = view.finished.length > 0
    ? 'Dagens evenemang är över.'
    : 'Inget på gång i Globenområdet idag.';
}

function renderEmptyState(view) {
  const empty = element('div', 'empty');
  empty.append(element('p', 'empty__lead', 'Lugnt i kvarteret idag.'));

  if (view.nextDay) {
    const when = dateFormatter.format(new Date(view.nextDay.events[0].startUtc));
    empty.append(element('p', 'empty__sub', `Nästa gång något händer är ${when}.`));

    const section = renderSection(`Nästa dag · ${when}`, view.nextDay.events);
    return [empty, section];
  }

  empty.append(element('p', 'empty__sub', 'Inga kommande evenemang hittades hos någon källa.'));
  return [empty];
}

/**
 * Listan över en källas evenemang, som fälls ut när man klickar på den i
 * källhälsan. Siffran där gäller allt källan levererade — inte bara idag — så
 * datumet måste stå med, annars är listan obegriplig.
 */
function renderSourceDetail(sourceId) {
  const source = state.sources.find((candidate) => candidate.id === sourceId);
  const now = Date.now();
  const todayKey = zonedDateKey(now);

  const events = state.events
    .filter((event) => event.sourceId === sourceId)
    .sort((a, b) => a.startUtc - b.startUtc);

  const panel = element('div', 'detail');
  panel.append(
    element('p', 'detail__caption', `${source.label} — ${events.length} kommande evenemang`),
  );

  // Scenkolumnen tillför bara något när källan täcker flera scener. För en arena
  // vore den samma ord om och om igen; för Slakthusen skiljer den Hus 7 från
  // Slaktkyrkan och Kapellet.
  const venues = new Set(events.map((event) => event.venue));
  const showVenue = venues.size > 1;

  const rows = element('ul', `detail__rows${showVenue ? '' : ' detail__rows--no-venue'}`);

  for (const event of events) {
    const isToday = zonedDateKey(event.startUtc) === todayKey;
    const row = element('li', `detail__row${isToday ? ' detail__row--today' : ''}`);

    row.append(
      element('span', 'detail__date', isToday ? 'idag' : formatListDate(event.startUtc, now)),
    );
    row.append(element('span', 'detail__time', formatTime(event.startUtc)));

    const link = element('a', 'detail__name', event.title);
    link.href = event.url ?? '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.append(link);

    if (showVenue) row.append(element('span', 'detail__venue', event.venue));
    rows.append(row);
  }

  panel.append(rows);
  return panel;
}

function renderSources(view) {
  const parts = [];

  const list = element('ul', 'sources__list');

  for (const source of state.sources) {
    const item = element('li');
    const expandable = source.ok && source.count > 0;

    if (!expandable) {
      const span = element('span', `sources__item${source.ok ? '' : ' sources__item--down'}`);
      span.textContent = source.ok
        ? `${source.label} · inga evenemang`
        : `${source.label} · svarar inte`;
      item.append(span);
      list.append(item);
      continue;
    }

    const isOpen = expandedSourceId === source.id;
    const button = element('button', `sources__item sources__item--button${isOpen ? ' is-open' : ''}`);
    button.type = 'button';
    button.textContent = `${source.label} · ${source.count} event`;
    button.setAttribute('aria-expanded', String(isOpen));

    button.addEventListener('click', () => {
      expandedSourceId = isOpen ? null : source.id;
      render();
    });

    item.append(button);
    list.append(item);
  }

  parts.push(list);

  if (expandedSourceId) parts.push(renderSourceDetail(expandedSourceId));

  const failed = state.sources.filter((source) => !source.ok);

  if (failed.length > 0) {
    parts.push(
      element(
        'p',
        'sources__note',
        'En eller flera källor svarade inte, så listan kan vara ofullständig. ' +
          'Att en plats saknas här betyder alltså inte säkert att det är lugnt där.',
      ),
    );
    for (const source of failed) {
      parts.push(element('p', 'sources__error', `${source.label}: ${source.error}`));
    }
  }

  const age = state.cacheAgeMs != null ? ` Data hämtad ${formatAge(state.cacheAgeMs)}.` : '';
  const stale = state.stale ? ' Senaste uppdateringen misslyckades — visar sparad data.' : '';

  parts.push(
    element(
      'p',
      'sources__note',
      'Klubbkvällarna har sluttider från källan; för övrigt uppskattas de utifrån typ av ' +
        `evenemang och skrivs då med ett ~.${age}${stale}`,
    ),
  );

  if (view?.finished.length > 0) {
    parts.push(element('p', 'sources__note', `${view.finished.length} evenemang har redan varit idag.`));
  }

  dom.sources.replaceChildren(...parts);
}

function renderError() {
  dom.headline.textContent = 'Kunde inte hämta evenemang.';

  const box = element('div', 'empty');
  box.append(element('p', 'empty__lead', 'Ingen källa svarade.'));
  box.append(element('p', 'empty__sub', state.error));
  dom.content.replaceChildren(box);
  dom.sources.replaceChildren();
}

function render() {
  const now = Date.now();
  dom.clock.textContent = formatTime(now);
  dom.date.textContent = dateFormatter.format(new Date(now));

  if (state.error) {
    renderError();
    return;
  }

  const view = buildTodayView(state.events, now);
  renderHeadline(view);

  const sections = [];
  if (view.live.length > 0) sections.push(renderSection('Pågår nu', view.live));
  if (view.upcoming.length > 0) sections.push(renderSection('Senare idag', view.upcoming));
  if (view.isEmpty) sections.push(...renderEmptyState(view));
  if (view.finished.length > 0) sections.push(renderSection('Tidigare idag', view.finished));

  dom.content.replaceChildren(...sections);
  renderSources(view);
}

/* ---------- Datahämtning ---------- */

async function load() {
  try {
    // Relativt till sidans adress. På localhost blir det /api/events, under
    // /globen/ blir det /globen/api/events — utan att appen behöver veta vilket.
    const response = await fetch('api/events');
    const body = await response.json();

    if (!response.ok) throw new Error(body.detail ?? body.error ?? response.statusText);

    state = {
      events: body.events ?? [],
      sources: body.sources ?? [],
      stale: Boolean(body.stale),
      cacheAgeMs: body.cacheAgeMs,
      error: null,
    };
  } catch (error) {
    state = { ...state, error: error.message };
  }

  render();
}

await load();
setInterval(render, RESTATUS_INTERVAL_MS);
setInterval(load, REFETCH_INTERVAL_MS);

// Kommer skärmen tillbaka efter att ha varit vilande är statusen gammal.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
