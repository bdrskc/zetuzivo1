# ZET uživo — odstupanja (DEVIATIONS)

Svako svjesno odstupanje od `zet.skoljka.org` / `ikicic/zet`, s razlogom.
Tamo gdje se izvor i živo ponašanje razlikuju, živo ponašanje je mjerodavno
(vidi `docs/00-REA-EVIDENCE.md`).

## 1. Jedan proces umjesto tri

Upstream zahtijeva tri terminala (frontend dev server, fetcher, HTTP server) i
SQLite bazu snimaka. ZET uživo je jedan Python asyncio proces koji dohvaća
feed, drži stanje, poslužuje HTTP + WebSocket i (u produkciji) frontend.
Razlog: jednostavnije pokretanje, manje pokretnih dijelova; feed, protokol i
ponašanje su isti. SQLite i `fetch_from_db.py` su izostavljeni.

## 2. Prilagođeni transport umjesto Flask/websockets

Upstream koristi Flask + flask-sock + websockets. ZET uživo koristi mali
vlastiti asyncio HTTP + RFC6455 WebSocket transport (`server/transports.py`).
Razlog: jedna luka za HTTP i WS, bez vanjskih okvira; smanjene ovisnosti.
Rizik: manje isproban kod — pokriveno testovima poslužitelja.

## 3. Markeri — obični MapLibre slojevi umjesto WebGL atlasa

Upstream crta markere vlastitim WebGL atlasom (`MarkerAtlas.ts`,
`WebGLMarkerRenderer.ts`). ZET uživo koristi uobičajene MapLibre circle +
symbol slojeve s istim pravilima boja (tram = plavo, bus = tamnoplavo,
isticanje = crveno, starost = sivo, strelica smjera rotirana, trag = linija,
ghost sloj za deklatiranje oznaka). **To NIJE kvar**: ponašanje koje korisnik
vidi ostaje isto; dokumentirano ovdje prema uputama.

## 4. WebGL2 bez WebGL1 fallbacka

Upstream README tvrdi "WebGL2, with WebGL1 fallback", ali isporučuje
maplibre-gl ^5.x koji zahtijeva WebGL2. ZET uživo prikazuje jasnu hrvatsku
poruku ako se karta ne može pokrenuti (WebGL2 nije dostupan). Razlog: iskreno
stanje tehnologije; MapLibre 5 više ne podržava WebGL1.

## 5. `?perf=1` / `?stress=1` izostavljeni

Upstream ima perf/stress način za dijagnostiku. ZET uživo ih ne nudi
(izborno). Razlog: smanjenje površine; korisničko ponašanje se ne mijenja.

## 6. Feedback je stub

`POST /api/feedback` uvijek vraća 501 s jasnom porukom; ništa se ne šalje niti
pohranjuje. Razlog: slanje e-poštom traži SMTP; bez njega ne šaljemo (u skladu
s uputama). Frontend obrazac je onemogućen uz objašnjenje. Upstream šalje
e-poštu (ili lokalnu datoteku preko `ZET_LIVE_FEEDBACK_FILE`); ZET uživo nema
ni to — dokumentirano. Ako se ikad doda SMTP, promijeniti `handle_feedback_stub`.

## 7. localStorage ključevi preimenovani

ZET uživo koristi vlastite ključeve: `vozlinija-filter-state`,
`vozlinija-news-seen-version-v1`, `vozlinija-location-tracking-enabled`
(upstream: `zet-*`). Razlog: ne dijelimo pohranu s drugim aplikacijama i ne
kupimo tuđe nazive. Ponašanje je isto.

## 8. Bez automatskog osvježavanja aplikacije

Poslužitelj objavljuje `app-version` poruku (kad postoji `web/dist/version.json`
i klijent traži `?appUpdates=1`), ali klijent ZET uživo ne preusmjerava stranicu
automatski pri novoj verziji. Razlog: izbjegavamo iznenadno osvježavanje; manje
koda. Upstream to čini s vjerojatnošću — izostavljeno svjesno.

## 9. Dev WebSocket ide kroz Vite proxy (isti origin)

Frontend otvara HTTP i WebSocket na isti host i port kao stranicu (`/ws-v4`,
`/static/…`). Vite u devu to prosljeđuje na poslužitelj `:5000`. U gotovoj
aplikaciji poslužitelj sam servira stranicu, pa podaci idu na taj isti port.
Prije je produkcija bila zakucana na `:5000`, pa Docker na 8080 nije vukao
stanice ni vozila.

## 10. Pravila privatnosti — novi, istiniti sadržaj

`web/public/privacy.html` nije kopija upstream verzije; opisuje točno što
ZET uživo radi (bez kolačića/traćenja, localStorage postavke, OpenFreeMap).

## 11. Brend i naslov

Naslov kartice, tab i „Informacije” koriste ime **ZET uživo**. Aplikacija i
dalje nije službena: crvena napomena u Info panelu kaže da nije ZET i nije
povezana sa Školjkom.

## 12. Naslovnica kontrolnih tipki

Tipke (Filtar, Informacije, Obavijesti, geolokacija, zoom) izgledaju slično
(gornji-desni i donji-desni), ali su React elementi s istim ulogama/oznakama,
ne MapLibre ctrl instance. Ponašanje je isto.

## 14. Glatko kretanje nadoknadom, bez lijepljenja na trasu

Upstream crta markere na svaku GTFS-RT poruku (≈ svakih 10 s) → vozila
skaču. Prva ZET uživo animacija interpolirala je **već protekli** interval i
projicirala točku na GTFS trasu s monotonim napretkom. Render petlja uzorkuje
samo "sada", pa je marker u trenutku nove poruke već bio na cilju (skok), a
prag od 40 m na trasi ga je znao i zamrznuti.

Sada (`web/src/vehicleAnimation.ts`): nova GPS točka je **odredište sljedećeg
intervala**. Marker krene s trenutačnog položaja na ekranu i ide ravnom
brzinom do te točke tijekom stvarnog razmaka između poruka (ograničeno na
4–14 s). Nema projekcije na `shapes.txt`. Skok veći od 800 m ili rupa duža
od 45 s samo preskoči. Strelica gleda smjer te dionice, ne trasu.

## 15. Interaktivne stanice s procjenom dolaska (poboljšanje)

Upstream nema popup-e stanica s dolascima. ZET uživo dodaje klasteriran sloj
stanica; klik prikazuje linije kroz stanicu s procjenom dolaska dobivenom iz
GTFS rasporeda + GTFS-RT uživo (novi endpoint `/static/schedule/v1/<key>`,
modul `web/src/eta.ts`). Riječ je o svjesnom proširenju; postojeći protokol
nije mijenjan.

## 16. Manje razlike u prikazu

- Trag vozila: linija (isto kao upstream); broj točaka traga u poruci = 6
  (isto: `TRAJECTORY_OUTPUT_LENGTH`).
- Popup kašnjenja: isti tekstovi ("Podaci kasne: …", "Neispravno vrijeme
  podataka").
- Prikazivanje stanica na trasi: kružići (upstream crta male stanice); isto
  vizualno značenje.

## 17. Identitet i dolasci stanica iz statičnog GTFS-a (poboljšanje)

Upstream stanice su samo točke (lat/lon) bez imena i bez interakcije. ZET uživo
poslužuje stanice iz `stops.txt` s `stop_id`, imenom i koordinatama te linijama
koje ih opslužuju (`/static/stops/v1/<key>`), a za odabranu stanicu mali payload
vožnji s cijelim `stop_times` redoslijedom i headsignom (`/static/stop/v1/<key>/<stop_id>`).
Cijela tablica stop_times se **ne** šalje u preglednik. Klik stanice otvara
donju ploču s dolascima po razinama (live / procjena / vozni red).

## 18. Interpolacija vozila na klijentu (poboljšanje)

Kretanje između 10-snih snimki računa se isključivo na klijentu (zidni sat,
LERP duž trase s monotonim napredovanjem, bearing duž trase). Komprimirani
koordinatni format ostaje nepromijenjen; backend ne lažira međupozicije.
Dodatni `tripUpdates` ključ u v2 realtime poruci je ZET uživo-ekstenzija
(dokumentirano u PROTOCOL.md).
