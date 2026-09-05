# Globen Live

En sida som svarar på frågan *vad händer i Globenområdet just nu?* — Avicii Arena,
3Arena, Hovet, Annexet och Slakthusområdet i en vy, med live-status på dagens
evenemang.

```bash
node server.js
```

Öppna sedan <http://localhost:3000>. Inga beroenden att installera; kräver Node 20+.

---

## Varför en server och inte bara en HTML-fil

Arenornas sajter skickar inga CORS-headers. En sida som öppnas från `file://` får
därför aldrig läsa deras svar, hur enkel hämtningen än är. Datan måste hämtas
serverside — det är hela anledningen till att det här är ett litet Node-program
och inte en fil man dubbelklickar på.

## Datakällor

| Plats | Källa | Metod |
|---|---|---|
| Avicii Arena | `aviciiarena.se` | JSON-LD (schema.org) i sidans HTML |
| 3Arena | `3arena.se` | JSON-LD (schema.org) i sidans HTML |
| Hovet | `hovetarena.se` | JSON-LD (schema.org) i sidans HTML |
| Annexet | `annexet.se` | JSON-LD (schema.org) i sidans HTML |
| Slakthusområdet | `slakthusen.se` | WordPress REST + tolkning av svensk brödtext |

De fyra arenorna drivs alla av Stockholm Live på samma plattform, så de delar en
enda hämtare — att lägga till en till är fyra rader i `ARENAS`. Två fallgropar:
Hovets domän är `hovetarena.se` (inte `hovet.se`, som inte pekar någonstans), och
källan lämnar HTML-entiteter orörda i JSON-LD:n, så namn måste avkodas.

Södra Teatern och Strawberry Arena hör till samma bolag men ligger på Södermalm
respektive i Solna, och ingår därför inte.

Arenorna hämtas i två steg. Listningssidan ger alla kommande evenemang, men med
generiska föräldranamn — "Djurgården Fotboll". För *dagens* evenemang hämtas även
eventsidan, som har det riktiga namnet: "DIF – Mjällby AIF (Allsvenskan)". Bara
dagens, så det blir sällan mer än en handfull extra anrop.

Området har ingen samlad kalender längre; `slakthusomradet.se` svarar 404 och
används inte.

Slakthusen låter dessutom gamla konserter ligga kvar publicerade, med utskrivet
år ("Datum: 6 maj, 2026"). De tolkas alltså korrekt men hör inte hemma här, så
allt som ligger före dagens början sorteras bort i `aggregate.js`. Gränsen går vid
dygnets början och inte vid "nu", så att eftermiddagens konsert finns kvar under
"Tidigare idag" resten av kvällen.

## Tre fällor koden är byggd runt

**Tidszoner.** Listningssidan anger en match som `17:00+00:00` och eventsidan som
`19:00+02:00`. Båda är korrekta och samma ögonblick, men läser man siffrorna rakt
ur listningens ISO-sträng blir tiden två timmar fel. All tid lagras därför som
absoluta instanter och formateras först vid visning, i `Europe/Stockholm`.
`test/stockholmlive.test.js` låser fast just det fallet mot en fixtur.

**Sluttider finns inte.** Ingen källa publicerar dem. "Pågår nu" bygger på en
uppskattad längd per typ av evenemang, och gränssnittet skriver ut det som
"beräknas hålla på till ~21:00" i stället för att låtsas veta.

**Slakthusens datum står i prosan.** REST-fältet `date` är publiceringsdatum. Det
riktiga datumet finns bara i texten — "Torsdag 26 november … Insläpp 19.00 … Live
från ca 20.00" — och året anges nästan aldrig, så det härleds till närmast
kommande förekomst. Arrangörerna skriver dessutom omväxlande svenska och engelska;
tolken hanterar båda, plus förkortade månader och ordningstal.

## Vad som händer när något går sönder

Källorna hämtas med `Promise.allSettled`, aldrig `Promise.all` — att Slakthusen
ligger nere ska inte dölja att det är match på 3Arena. Varje källas utfall visas
längst ned på sidan, och misslyckas någon skrivs det ut tillsammans med felet.

Det är avsiktligt: utan den raden går det inte att skilja *lugn kväll i
Globenområdet* från *skraparen är trasig*. Båda ser ut som noll evenemang.

Klicka på en källa för att fälla ut vilka evenemang den levererat, med datum —
siffran "6 event" säger annars inte vilka. Scenkolumnen visas bara när källan
täcker flera scener, som Slakthusen.

Misslyckas en uppdatering serveras senast lyckade data vidare, märkt med hur
gammal den är.

## Struktur

```
server.js              HTTP-server: statiska filer, /api/events, cache
src/
  timezone.js          Europe/Stockholm via Intl — enda stället tid formateras
  swedishDate.js       tolkar "Torsdag 26 november … Live från ca 20.00"
  normalize.js         eventmodell, statusberäkning, längduppskattning
  aggregate.js         slår ihop källorna, rapporterar hälsa per källa
  cache.js             TTL-cache som faller tillbaka på gammal data
  jsonld.js            plockar schema.org-data ur HTML
  sources/             en fil per datakälla
public/                gränssnittet
test/                  55 tester, inklusive nätoberoende fixturer
```

`normalize.js` och `timezone.js` serveras även till webbläsaren, så statuslogiken
finns i exakt en implementation. Klienten räknar om status var 30:e sekund och
hämtar ny data var tionde minut.

```bash
npm test
```

## Begränsningar

- **Sluttider är uppskattningar**, inte data.
- **Slakthusområdet är ofullständigt.** Slaktkyrkan, Hus 7 och Kapellet täcks via
  `slakthusen.se`. Ett tiotal inlägg har datumformat som tolken inte klarar, och för
  ungefär lika många saknar texten klockslag helt — de visas med tiden flaggad som
  gissad.
- **Klubben Slakthuset ingår inte.** Dess klubbkvällar publiceras aldrig i
  `slakthusen.se`-flödet utan säljs via Billetto, som är en egen datakälla. Detsamma
  gäller restauranger och popup-event i området.
- **Skrapning är sprött till sin natur.** Byggs arenornas sajter om slutar
  JSON-LD-uttaget fungera — men källhälsan gör att det märks direkt i stället för
  att sidan tyst visar noll evenemang.
- `fallan.nu` är byggd i Webflow utan strukturerad data och ingår inte.
