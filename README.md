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
| Klubbscenerna | `ra.co` (Resident Advisor) | GraphQL — Slakthuset, Slaktkyrkan, Fållan |

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

**Sluttider finns bara ibland.** Resident Advisor publicerar dem alltid, och
Slakthusens eventsidor för de evenemang vi hämtar sidan för. För allt annat bygger
"pågår nu" på en uppskattad längd per typ av evenemang, och skillnaden syns i
gränssnittet: "håller på till 03:00" när det är data, "beräknas hålla på till
~21:00" när det är en gissning. En gissning ska aldrig se ut som ett faktum.

**Slakthusens datum står i prosan.** REST-fältet `date` är publiceringsdatum. Det
riktiga datumet finns bara i texten — "Torsdag 26 november … Insläpp 19.00 … Live
från ca 20.00" — och året anges nästan aldrig, så det härleds till närmast
kommande förekomst. Arrangörerna skriver dessutom omväxlande svenska och engelska;
tolken hanterar båda, plus förkortade månader och ordningstal.

Deras **eventsidor** har däremot samma uppgifter i märkta element, med årtal och
sluttid:

```html
<div class="datum-b"><p>lördag sep 05, 2026</p></div>
<div class="tid-b"><p>14.00 - 00.00</p></div>
Slaktkyrkan,  Styckmästargatan 10
```

Fälten renderas av sidmallen och följer inte med i REST-svaret, så de kostar ett
anrop per evenemang. Därför hämtas de bara där de gör skillnad: för **dagens**
evenemang, och för de inlägg vars datum inte gick att tolka ur prosan — de syns
annars inte alls. Det brukar bli ett dussin anrop, mot nittio om allt hämtades.

Källorna kombineras, inte ersätts. Sidan äger datumet och sluttiden. Men dess enda
tidsfält är inte alltid speltiden: Countryhus vol. 4 har `tid-b` 20:00 medan prosan
skiljer på "Insläpp: 20.00" och "Live: ca 21.00". Har prosan hittat en riktig
speltid är den mer precis och behålls — fast flyttad till sidans datum.

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

## Att ingen ska behöva vänta

Att hämta alla källor tar sekunder — uppmätt till 17 från servern en kall gång.
Med en vanlig cache betalar första besökaren efter varje utgång hela den
kostnaden. `cache.js` gör därför tre saker:

- **Uppvärmning vid start.** Servern hämtar allt när den startar, innan någon
  hunnit fråga. Loggen skriver ut hur lång tid det tog.
- **Utgången data serveras direkt** medan uppdateringen sker i bakgrunden.
  Evenemangslistor ändras inte minut för minut, så några minuters ålder är ett
  bättre svar än flera sekunders väntan.
- **Riktigt gammal data väntar däremot in en hämtning.** Har ingen besökt sidan
  på över en timme kan programmet ha hunnit ändras, och då är sekunderna värda
  det.

Resultatet är att bara serverstarten någonsin betalar hämtningen. Besökaren får
svar på millisekunder.

## Att ligga under en katalog

Alla sökvägar i gränssnittet är relativa, aldrig rotabsoluta. Sidan fungerar
därför både på `localhost:3000/` och under en katalog på en delad domän, som
`example.se/globen/`, utan konfiguration.

Det är inte kosmetik. Med rotabsoluta sökvägar hade sidan begärt
`/public/app.js`, `/src/normalize.js` och `/api/events` från **domänroten** — och
fungerat bara om värdservern vidarebefordrade de tre sökvägarna till oss. Appen
hade då gjort anspråk på tre sökvägar mitt på en sajt den delar domän med, och
krockat den dagen värdsajten själv vill använda `/api/`.

`test/paths.test.js` vaktar mot att ett ledande snedstreck smyger tillbaka.

Ett nginx-block för att lägga appen under en katalog ser ut så här — det
avslutande snedstrecket i `proxy_pass` är det som klipper bort prefixet:

```nginx
location /globen/ {
    proxy_pass http://127.0.0.1:8080/;
}
```

## Struktur

```
server.js              HTTP-server: statiska filer, /api/events, cache
src/
  timezone.js          Europe/Stockholm via Intl — enda stället tid formateras
  swedishDate.js       tolkar "Torsdag 26 november … Live från ca 20.00"
  normalize.js         eventmodell, statusberäkning, längduppskattning
  aggregate.js         slår ihop källorna, slår ihop dubbletter, rapporterar hälsa
  cache.js             cache som värms vid start och aldrig får någon att vänta
  jsonld.js            plockar schema.org-data ur HTML
  sources/             en fil per datakälla
public/                gränssnittet
test/                  94 tester, inklusive nätoberoende fixturer
```

`normalize.js` och `timezone.js` serveras även till webbläsaren, så statuslogiken
finns i exakt en implementation. Klienten räknar om status var 30:e sekund och
hämtar ny data var tionde minut.

```bash
npm test
```

## Begränsningar

- **Sluttider finns bara ibland.** Resident Advisor publicerar dem alltid, och
  Slakthusens eventsidor för de evenemang vi hämtar sidan för. Övrigt uppskattas,
  och gränssnittet skiljer på fallen med ett ~.
- **Slakthusområdet är ofullständigt.** Slaktkyrkan, Hus 7 och Kapellet täcks via
  `slakthusen.se`. Ett tiotal inlägg saknar klockslag i prosan och visas med tiden
  flaggad som gissad — utom de vi hämtar eventsidan för, där tiden är exakt.
- **Klubbkvällarna täcks bara delvis.** Resident Advisor når Slakthuset,
  Slaktkyrkan och Fållan, men bara det som är elektronisk musik — RA:s nisch. En
  jämförelse mot Billetto visade att källorna överlappar dåligt: av fyra
  Slakthuset-kvällar fanns bara en på båda. Restauranger och popup-event syns inte
  alls.
- **Billetto ingår inte, trots bättre data per event.** Deras eventsidor har den
  rikaste JSON-LD:n av alla källor, men arrangörslistan byggs av JavaScript —
  serversvaret innehåller noll evenemang, även hämtat inifrån en webbläsare med
  riktiga cookies. Att nå den skulle kräva en huvudlös webbläsare på servern, vilket
  skulle avsluta noll-beroenden-designen för en enda scen.
- **Skrapning är sprött till sin natur.** Byggs arenornas sajter om slutar
  JSON-LD-uttaget fungera — men källhälsan gör att det märks direkt i stället för
  att sidan tyst visar noll evenemang.
- `fallan.nu` är byggd i Webflow utan strukturerad data; Fållan täcks i stället
  via Resident Advisor.
- **RA:s API är odokumenterat.** Det är deras egen frontend-endpoint, utan löften
  om stabilitet. Källhälsan gör att ett schemabyte märks direkt.
