/**
 * Gränssnittet.
 *
 * Statuslogiken importeras från samma moduler som servern använder, så "pågår nu"
 * beräknas på ett enda ställe. Servern serverar /src/ just för det.
 *
 * Två takter: statusen räknas om var 30:e sekund lokalt (billigt, ingen nätverkstrafik),
 * medan ny data hämtas var tionde minut.
 */

import { STATUS, buildTodayView } from '/src/normalize.js';
import { formatTime, zonedDateKey } from '/src/timezone.js';

const RESTATUS_INTERVAL_MS = 30_000;
const REFETCH_INTERVAL_MS = 10 * 60_000;

const ACCENTS = {
  'avicii-arena': 'var(--avicii)',
  '3arena': 'var(--arena3)',
  hovet: 'var(--hovet)',
  annexet: 'var(--annexet)',
  slakthusen: 'var(--slakthuset)',
};

const dom = {
  headline: document.getElementById('headline'),
  content: document.getElementById('content'),
  date: document.getElementById('today-date'),
  clock: document.getElementById('clock'),
  sources: document.getElementById('sources'),
};

let state = { events: [], sources: [], stale: false, staleReason: null, error: null };

/* ---------- Formatering ---------- */

const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Stockholm',
});

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

  // Sluttiden är en uppskattning — inte data från någon källa. Det ska synas.
  if (event.status === STATUS.NOW) {
    foot.append(element('span', 'meta', `beräknas hålla på till ~${formatTime(event.estimatedEndUtc)}`));
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
    : 'Inget på gång i Johanneshov idag.';
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

function renderSources(view) {
  const parts = [];

  const list = element('ul', 'sources__list');
  for (const source of state.sources) {
    const item = element('li', `sources__item${source.ok ? '' : ' sources__item--down'}`);
    item.textContent = source.ok ? `${source.label} · ${source.count} event` : `${source.label} · svarar inte`;
    list.append(item);
  }
  parts.push(list);

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
      `Sluttider är uppskattade utifrån typ av evenemang — ingen källa publicerar dem.${age}${stale}`,
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
    const response = await fetch('/api/events');
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
