# Dnevnik promjena (CHANGES)

Svaki značajan korak: datum, što, koje datoteke, zašto, kako provjeriti.
Ažurira se nakon svake promjene.

## 2026-11-13 — Ikone vozila nacrtane odmah

Tramvaj i autobus više se ne učitavaju kao slika. Pikseli su u kodu i
crtaju se na kartu prije sloja, pa se ikone vide i iz Dockera.

## 2026-11-13 — Ikone vozila u samoj stranici

Slike tramvaja i autobusa više se ne traže kao zasebne datoteke. Ugrađene
su u stranicu, pa se vide i kad aplikacija radi iz Dockera.

## 2026-11-13 — Ikone u Dockeru i scroll tražilice

Poslužitelj sada daje `tram-marker.png` i `bus-marker.png`, pa se ikone
vozila vide i iz gotove slike. Scroll u tražilici više ne prelazi preko
stanice i zvjezdice.

## 2026-11-13 — Podaci na istom portu

Gotova stranica je tražila stanice i vozila na portu 5000. Kad Docker sluša
na 8080, karta je ostajala prazna. Sada ide na isti port kao stranica.

## 2026-11-13 — Tražilica: tramvaj i autobus

Tramvaj je puni plavi okvir, autobus tamni. Broj tramvaja je plavi kvadratić,
broj autobusa bijeli obrub.

## 2026-11-13 — Engleski

Gumb EN/HR uz kontrole karte prevodi sučelje. Imena stanica, odredišta i
tekst ZET obavijesti ostaju kako dolaze iz podataka.

## 2026-11-13 — Tramvaj i autobus u tražilici

Rezultati su razdvojeni: prvo tramvajske stanice i linije, pa autobusne.
Svaku skupinu vodi tanka ikona vozila u boji linije.

## 2026-11-13 — Šira tražilica

Prozor tražilice je širi da naziv stanice i linije ne prelaze preko teksta.
Na uskom ekranu gumbi karte kreću ispod trake pretrage.

## 2026-11-13 — Zvjezdica u tražilici i upitnik

Stanicu se može spremiti zvjezdicom čim se pojavi u rezultatima. Gumb ?
gore desno otvara kratke upute.

## 2026-11-13 — Docker za hosting

Višeslojni `Dockerfile`: Node samo za build, u slici ostaje Python 3.12 i
gotova karta. Pokretanje: `docker build -t zet-uzivo .` pa
`docker run -p 5000:5000 zet-uzivo`.

## 2026-11-13 — Stanica, neaktivne linije, odlazak na vozilo

Stanica u tražilici je cijeli gumb, kao omiljena; liniju se i dalje upisuje.
Linija koja trenutno nema vozilo prema toj stanici je siva. Klik na dolazak
odvede na to vozilo. Na ploči nema riječi „procjena”: ostaje plan i
„raniji/kasniji”. Aktivne linije na stanici idu prve, pa mali razmak, pa sive.

## 2026-11-13 — Ime je ZET uživo

Aplikacija se svugdje zove ZET uživo. Nije službena ZET aplikacija; napomena
u Info panelu to i dalje kaže.

## 2026-11-13 — Feed se više ne gasi na 429

Osvježavanje voznog reda koje ZET odbije (429) više ne ruši poslužitelj.
Ako pri pokretanju nema mreže, učita se zadnji spremljeni vozni red.

## 2026-11-13 — Smjer po zapisanoj ruti

Tramvaj i autobus gledaju u smjeru u kojem je ruta zapisana. GPS koji padne
malo iza vozila više ga ne okrene.

## 2026-11-13 — Omiljene, autobus na trasi, glađe kretanje

Cijela kartica omiljene stanice otvara stanicu. Linije su samo natpis, da se
ne pogodi krivi red. Autobus se, kao tramvaj, crta na svojoj ruti. Brzina
između GPS točaka ostaje ujednačena, bez zaustavljanja na svakom očitanju.

## 2026-11-13 — Tragovi, glađe GPS, uredniji izgled

Plave crte iza autobusa su maknute, kao i one iza tramvaja. Između dva GPS
očitanja vozilo ubrzava i usporava, pa nakon cilja još kratko klizi umjesto
da stane. Tražilica je gore lijevo, gumbi gore desno, zum i lokacija dolje
lijevo, da se ništa ne preklapa.

## 2026-11-13 — Smjer tramvaja po trasi

Tramvaj na ruti više ne nasljeđuje bočni pomak GPS-a. Nos prati tračnice i
kad stoji, pa na vodoravnoj ulici ne gleda prema sjeveru.

## 2026-11-13 — Maknut trag iza tramvaja

Plava crta iza tramvaja se više ne crta.

## 2026-11-13 — Omiljene uz tražilicu, tramvaj na trasi

Gumb sa zvjezdicom stoji desno od tražilice. Klik otvara spremljene stanice
i linije koje tamo voze (smjer se učita čim stigne). Tramvaj se crta na
najbližoj točki svoje GTFS rute i između dvije GPS točke ide po toj liniji,
ne prečacem. Na petlji ostaje na kraku kojim već vozi. Autobus ostaje na
sirovom GPS-u. Ako je točka dalje od 90 m od rute, tramvaj se ne vuče na nju.

## 2026-11-13 — Omiljene, trasa, sutra i kašnjenje

Zvjezdica na ploči sprema stanicu u preglednik. Procjena udaljenosti ide po
GTFS trasi, ne ravno od stanice do stanice, pa zavoji i petlje više ne
skraćuju vrijeme. Stanica koja danas ne vozi, a sutra ili vikendom vozi, ima
šuplju točku i natpis (sutra, vikendom). Ploča pokazuje prvih pet dolazaka i
gumb Još. Planirani sat ostaje, a uz njega piše koliko vozilo kasni.

## 2026-11-13 — Maknute neiskorištene stanice

GTFS ima uz svaki peron i praznu nadređenu stanicu istog imena (npr. Branimirova
tržnica: dva perona i jedna siva točka koju nijedna linija ne koristi). Takve
se više ne šalju na kartu. Peron koji vozi samo vikendom ostaje.

## 2026-11-13 — Dolasci bez limita od 20 min i 10 stanica

Ploča stanice više ne krije dolazak dulji od 20 minuta niti vozilo koje je
dalje od 10 stanica. Procjena za daleko vozilo više vjeruje voznom redu
(uključuje stajanje), a za blisko zadnjim GPS uzorcima.

## 2026-11-12 — Autobus, manje strelice, veće stanice

Autobus ima ikonu odozgo, broj u sredini. Strelica smjera je manja i ispred
nosa. Stanice su veće (i rastu s zumom) da se lakše pogode.

## 2026-11-12 — Novi logo i manji tramvaji izdaleka

Logo je zamijenjen novom slikom. Strelica smjera je opet ispred nosa.
Veličina loga i broja prati zum karte, da prikaz cijelog grada ne bude zbrkan.

## 2026-11-12 — Logo tramvaja

Tramvaj više nije kružić. Na karti je logo odozgo, nos u smjeru vožnje.
Broj linije je bijel, uspravan, u sredini tijela između prozora. Autobus
ostaje kružić.

## 2026-11-12 — Tamni način i strelice smjera

Gumb mjeseca/sunca (ispod informacija) prebacuje svijetlu i tamnu kartu.
Izbor ostaje u pregledniku. Boje linija ostaju iste: tramvaj `#0b62b9`,
autobus `#26456b`, skori dolazak `#e2294f`. Strelica ispred vozila je puna
strelica s bijelim rubom, tik uz kružić, u smjeru vožnje.

## 2026-11-12 — Raspored se parsira jednom

GTFS zip se više ne čita iznova za svaki dan i svaku stanicu. `ScheduleDb`
drži vožnje, a dnevni indeks je samo filter. Odgovor stanice izostavlja
vožnje koje su završile prije više od 20 minuta, pa je JSON manji, a predmemorija
je po stanici i po pet minuta.

## 2026-11-12 — Dolasci, brzina, ploča

Procjena više ne dijeli šum GPS-a niti cijelu GTFS trasu. Vrijeme iz ZET-a
koje je već prošlo, a vozilo je još prije stanice, zamjenjuje se udaljenošću
duž stanica i tempom voznog reda. Na ploči je jedan red po liniji i smjeru,
s oznakom uživo ili procjena. Tramvaj je i dalje `#0b62b9`, autobus `#26456b`,
skori dolazak `#e2294f`.

Stranica više na startu ne skida sve trase. Stanice se crtaju samo u kadru,
vozila oko 20 puta u sekundi.

## 2026-11-12 — AppView rastavljen na module

`AppView.tsx` više ne drži kartu, feed, stanice i ploče u jednoj datoteci.
Isto ponašanje, manji dijelovi: `useZagrebMap`, `useLiveFeed`, `useStopBoard`,
`useNews`, `sheets`, `filterState`, `routeOverlay`, `selection`.

## 2026-11-12 — Kretanje nadoknadom + server popravci

Stara 60 FPS animacija interpolirala je interval koji je već prošao i
lijepila marker na GTFS trasu. Render petlja vidi samo "sada", pa je vozilo
na svakoj poruci već bilo na cilju (skok), a monoton napredak po trasi ga je
znao i zaustaviti. Novo (`vehicleAnimation.ts`): nova točka je odredište
**sljedećih** 4–14 s, kreće se s trenutačnog piksela ravnom brzinom, bez
trase. Test: `npm run test:anim` (marker odmah nakon poruke još nije na cilju).

Uz to:
- StopIndex i parsiranje GTFS zipa idu izvan event loopa (`asyncio.to_thread`).
- `stop_id` u `/static/stop/...` se URL-dekodira.
- v2 šalje `tripUpdates` samo za vožnje koje imaju vozilo.
- WebSocket ide kroz Vite (isti origin), ping svakih 30 s, prekid nakon 180 s
  tišine, najviše 200 klijenata, limit veličine framea.
- Feedback je uvijek 501, i kad je SMTP varijabla postavljena.
- Procjena dolaska: dionica između stanica umjesto najbliže stanice; odbacuje
  GPS šum i nemoguću brzinu.

## 2026-11-12 — Tražilica: klik na ime stanice odabire stanicu

Naziv stanice u rezultatima sada je klikabilan (odabire stanicu i leti na
nju); smjerovi (linija → destinacija) ispod ostaju informativni, bez klikova
(`SearchBox.tsx`, `styles.css`).

## 2026-11-12 — Tražilica pokazuje smjerove („11 Dubec"), ploča bez „Sve linije"

Uklonjena sekcija "Sve linije kroz stanicu" s ploče (ostaju samo živi dolasci).
Smjerovi su sada **u tražilici**: kad upišeš stanicu (npr. "Petrova"), ispod
imena stanice se pojavljuju retci **linija → destinacija** (npr. "11 Dubec",
"11 Spr.Dubrava", "12 Park Maksimir"), lazily s `/static/stop`
(`eta.ts` → `stopDestinations`, `SearchBox` → `resolveStopLines`).

## 2026-11-12 — Ploča stanice: sve linije s destinacijama

Uz žive dolaske, ploča stanice sada prikazuje i **sve linije kroz stanicu** s
**tekstualnim destinacijama** (iz `headsign` vožnji u `/static/stop`): npr.
stanica Petrova → "Linija 12: Dubrava / Park Maksimir", "Linija 11: Dubec /
Spr.Dubrava"… (tramvaji prvo, zatim autobusi; po platformi — samo smjerovi
koji stvarno prolaze tom stanicom). `AppView.tsx` → `stopLines` + `StopSheet`
sekcija "Sve linije kroz stanicu"; provjereno pravim podacima.

## 2026-11-12 — Tražilica stanica/linija + još veća strelica vozila

- Nova tražilica u gornjem lijevom kutu (`web/src/SearchBox.tsx`): pretražuje
  stanice po imenu (s popisom linija) i linije po broju; odabir stanice je
  odabire i leti na nju (zoom 16), odabir linije uključuje filter za tu liniju
  i leti na stanicu te linije (zoom 15). Rad na lokalnom indeksu iz
  `/static/stops/v1` — bez servera.
- Strelica vozila još veća: `icon-size 1.0`, `icon-offset [0, -42]`
  (`vehicleLayers.ts`).

## 2026-11-12 — Strelica vozila: jasnije ispred, veća, obojena po tipu

Strelica više ne ovisi o SDF `icon-color` (koji se mogao tiho ne primijeniti):
sada su to **dva konkretna PNG trokuta** — `vozlinia-arrow-tram` (svijetloplava)
i `vozlinia-arrow-bus` (tamnija) s bijelim obrubom — birana `icon-image`
izrazom prema tipu vozila. Pomaknuta **više ispred** vozila
(`icon-offset [0, -32]`, izvan kruga r15) i veća (`icon-size 0.65`).

## 2026-11-12 — Strelica vozila: veća, ispred vozila, u boji po tipu

`vozlinia-arrow` sada: `icon-size 0.55` (veća), `icon-offset [0, -23]`
(ispred kruga, na prednjem rubu po bearingu), a slika je SDF pa je bojimo
`icon-color`-om prema tipu vozila — tram svjetlije plava (`#3aa0f4`), bus
tamnija (`#1b5fa4`), kao i samo vozilo (`vehicleLayers.ts` → `makeArrowIcon` +
arrow sloj).

## 2026-11-12 — Format retka + strelica smjera na vozilu

Red na ploči sada: broj linije (značka) · destinacija (headsign) · minute
(npr. "6 · Sopot · 8 min"); uklonjen tekst "procjena" (`AppView.tsx` →
`departureRowText`). Strelica smjera vozila je bila prekrivena krugom
(vozlinia-arrow ispod vozlinia-vehicle-circle); sada je iznad kruga, na
prednjem rubu po bearingu (icon-rotate + icon-offset, filter dir != null)
(`vehicleLayers.ts`).

## 2026-11-12 — Ploča stanice: samo dolasci do 20 min + veća ploča i font

U `AppView.tsx` (`sortStopDepartures`) dodan `MAX_DISPLAY_MINUTES = 20`:
svi dolasci koji stižu za više od 20 minuta se odbacuju (uz već postojeći
filtar do 10 stanica). Ploča i font dodatno povećani (`styles.css`):
`max-height 72%`, `width 430px`, font 1.3rem, značka linije 1.25rem.

## 2026-11-12 — Ploča stanice: redoslijed po vremenu (najbliži prvi) + veći font

Dolasci na ploči sortirani od najmanje prema najviše minuta (uklonjene
"Tramvaji/Autobusi" sekcije koje su remetile redoslijed); ploča veća i font
veći (`AppView.tsx` → `sortStopDepartures`, `styles.css`).

## 2026-11-12 — Stanice: samo vozila do 10 stanica od odabrane

Dodan filtar `MAX_STOPS_AHEAD = 10` u `computeStopDepartures`: prikazuju se
samo tramvaji/vozila čija je pozicija (po `stop_sequence`) unutar 10 stanica
prije odabrane; dalja vozila (procjene od sati) i ona koja su već prošla se
odbacuju. Test (slučaj 10) + provjera pravim feedom (Črnomerec bez procjene od
~131 min). PROTOCOL opisan.

## 2026-11-12 — Stanice: samo živi dolasci (bez "vozni red")

Na stanicama se više ne prikazuje "vozni red" (timetable): `computeStopDepartures`
ne emitira tier-4 retke; ostaju samo **live** (TripUpdate STU/delay) i
**procjena** (po trasi, u minutama). UI pojednostavljen (bez "vozni red"
grana), testovi 5/8/9 ažurirani, PROTOCOL opisan. Provjereno pravim feedom:
Črnomerec → 11 live redaka, 0 "vozni red".

## 2026-11-12 — Popravak dolazaka (wire-shape) + prijašnji unosi

**Dolasci "Trenutno nema dolazaka":** popravljen uzrok — poslužitelj šalje
`times` kao kompaktne nizove `[stopId, seq, arrivalSec, departureSec]`, a
klijent je na "stanici" očekivao objekte, pa je svaka vožnja bila preskočena
(`normalizeStopServices` u `web/src/eta.ts` + korištenje u `AppView.tsx`).
Provjereno na pravom feedu: Črnomerec → 188 redaka (11 live + 177 vozni red).
Regresijski test u `test-eta.ts` (slučaj 9). Python testovi i animacijski testovi
nepromijenjeni/prolaze.

## 2026-11-12 — Stanice s dolascima (4 razine) + glatko kretanje po trasi

**Što:**
1. **Stanice iz statičnog GTFS-a** (ne više koordinate-only): server čita
   `stops.txt`/`routes.txt`/`trips.txt`/`stop_times.txt` i nudi
   `GET /static/stops/v1/<key>` (identitet + linije po stanici) i
   `GET /static/stop/v1/<key>/<stop_id>` (mali payload vožnji s headsignom i
   cijelim `stop_times` redoslijedom). Cijela stop_times tablica se **ne**
   šalje pregledniku (`server/staticdata.py` → `StopIndex`, `server/server.py`).
2. **Interaktivne stanice na karti**: klik stanice odabire je i otvara donju
   ploču; klik prazne karte poništava odabir (isto kao vozilo); odabir vozila i
   stanice se ne bore — ploča pokazuje posljednje odabrano. Stanice se crtaju
   neutralnom točkom (tram = jantarna, bus = siva), ime samo na uličnom zoomu
   ili za odabranu; izvan uličnog zooma samo stanice odabrane linije/aktivnog
   filtera (`web/src/stops.ts`, `web/src/AppView.tsx`).
3. **Dolasci u 4 razine** (`web/src/eta.ts`): (1) TripUpdate stop_time_update
   za stop (`arrival.time` ili planirano+`arrival.delay`), (2) TripUpdate
   `delay` na planirano vrijeme, (3) procjena iz pozicija (udaljenost duž
   trase / brzina iz zadnja dva uzorka; uzorci stariji od 30 s se odbacuju),
   (4) vozni red iz rasporeda. Vozilo koje je prošlo stanicu se odbacuje;
   `vozni red` se nikad ne prikazuje kao live; stale feed zamrzava retke.
   Osvježava se na svaku novu realtime poruku (bez HTTP-a svake sekunde).
4. **Glatko kretanje**: interpolacija na klijentu (zidni sat, duž trase s
   monotonim napredovanjem; bez trase → polilinija zadnjih pozicija; bearing
   duž trase; preskok ako je pomak duž trase prevelik / raskorak > 45 s /
   reduced-motion; pauza kad je tab skriven). Wire kompresije nepromijenjen,
   backend ne lažira GPS.
5. **Feed zapis**: PROTOCOL.md bilježi stvaran sadržaj žive poruke (VP ~319,
   TripUpdate ~541, STU ~633 (arrival ~320), TripUpdate.delay 0,
   current_stop_sequence odsutan) i novi `tripUpdates` ključ u v2.
**Zašto:** zahtjev korisnika: stanice s dolascima i glatko kretanje.
**Kako provjeriti:** odaberi poznatu stanicu (npr. na glavnom trgu), provjeri
da navedena linija u GTFS-u doista staje na nju i da se "vozni red"/live
razlikuju; gledaj vozilo preko jedne 10-sne snimke — mora glatko kliziti duž
trase bez skoka (skok samo za loš GPS). Testovi: `python -m unittest discover -s
tests` (23), `cd web && npm run test:anim && npm run test:eta`.

## 2026-11-12 — Glatko kretanje vozila (popravak) + interaktivne stanice s procjenom dolaska

**Što:**
1. **Animacija vozila prebačena na zidni sat.** Greška: animacija se temeljila
   na `feedTimestamp` (vremenske oznake feeda mogu odstupati od stvarnog vremena),
   pa je faktor interpolacije skakao na 0/1 — vozila su stajala pa skočila.
   Sada se prozor animacije računa od **stvarnog vremena dolaska** dviju poruka
   (`web/src/vehicleAnimation.ts`, `t0/t1 = wallNow`), a `feedTimestamp` služi
   samo za prikaz/starost.
2. **Priljubljivanje vozila na trasu napredno:** interpolirana točka se
   projicira na poliliniju trase i pomiče **monotono duž nje** (arc-length
   progress) — bez treperenja na sjecištima/paralelnim dionicama
   (`projectWithDistance`, `pointAtDistance`, `PROGRESS_SLACK_M`).
3. **Interaktivne stanice s procjenom dolaska:**
   - `server/staticdata.py`: novi `GtfsSchedule` — parsira `calendar.txt`,
     `calendar_dates.txt`, `trips.txt`, `stop_times.txt` (samo za danas),
     gradi kompaktan indeks po stanicama i vožnjama.
   - `server/server.py`: nova ruta `GET /static/schedule/v1/<key>` (lazy build,
     cache po (key, datum)); `StaticDataSnapshot` čuva sirovi zip.
   - `web/src/eta.ts`: procjena dolaska — live vozilo se mapira na najbližu
     stanicu vožnje; odstupanje = `vehicle.timestamp − planirano`; ETA =
     planirani dolazak + odstupanje; vozila koja su već prošla se preskaču;
     bez vozila → raspored.
   - `web/src/stops.ts`: sloj stanica (klasteri) + klik → popup s linijama i
     procjenama (žuta slova, tram/bus bojom).
   - `web/src/AppView.tsx`: eager učitavanje rasporeda, popup stanice,
     redoslijed slojeva (stanice ispod vozila).
4. Testovi: `tests/test_schedule.py` (3), `web/scripts/test-eta.ts`;
   animacijski testovi ažurirani za zidni sat.
**Zašto:** zahtjev korisnika: glatko kretanje + ETA po stanicama.
**Kako provjeriti:** python testovi (20), `cd web && npm run test:anim &&
npm run test:eta`; otvori http://127.0.0.1:5000/ i klikni stanicu.

# Dnevnik promjena (CHANGES)

Svaki značajan korak: datum, što, koje datoteke, zašto, kako provjeriti.
Ažurira se nakon svake promjene.

## 2026-11-12 — Popravak: Vite dev nije se učitavao (IPv6-only binding)

**Što:** Vite je vezao samo na `[::1]:5173`, a preglednik/`localhost` je na ovom
stroju rješavao na IPv4 → stranica se nije otvorila. Promijenjeno u
`web/vite.config.ts`: `server.host: "127.0.0.1"` + `strictPort: true` (ne
prelazi tiho na 5174). Uklonjen zastarjeli `::1` slušač. Sada i
`http://127.0.0.1:5173/` i `http://localhost:5173/` rade i prikazuju kartu
(potvrđeno DOM-om: canvas 1, bez error kutije, sve tipke).
**Zašto:** korisnički zahtjev "it wont load vite dev".
**Kako provjeriti:** `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` → 200.

# Dnevnik promjena (CHANGES)

Svaki značajan korak: datum, što, koje datoteke, zašto, kako provjeriti.
Ažurira se nakon svake promjene.

## 2026-11-12 — Animacija vozila na 60 FPS (LERP + snapping + smjer)

**Što:** Vozila se više ne teleportiraju između koordinata; frontend
interpolira položaje između dvije GTFS-RT snimke (~10 s) na 60 FPS.
- `web/src/vehicleAnimation.ts` (novo): `VehicleAnimator` —
  1) LERP između zadnje i najnovije pozicije (ease-in-out), 2) priljubljivanje
  na trasu (`shapes.txt` iz GTFS static; `projectToPolyline`, prag 300 m,
  skok > 800 m = teleport bez animacije), 3) interpolacija smjera (najkraći
  kut između segmenata) za glatku rotaciju strelice.
- `web/src/AppView.tsx`: `requestAnimationFrame` petlja (60 FPS) koja uzima
  interpolirane uzorke i ažurira slojeve; identitet/odabir ostaju na sirovim
  vozilima; klik rješava vozilo po ključu (ne po indeksu).
- `web/src/vehicleLayers.ts`: klik predaje `key`.
- `web/scripts/test-animation.ts` (novo) + `npm run test:anim`: provjera LERP-a
  (sredina 35 m od oba kraja), snappinga (0 m od polilinije), interpolacije
  smjera (0→45→90), teleporta i `projectToPolyline` — **sve prolazi**.
**Zašto:** korisnički zahtjev — glatko kretanje vozila umjesto skokova.
**Kako provjeriti:** `cd web && node scripts/test-animation.ts`; otvori
http://127.0.0.1:5000/ (živi feed) i gledaj markere kako klize između ažuriranja.

# Dnevnik promjena (CHANGES)

Svaki značajan korak: datum, što, koji datoteke, zašto, kako provjeriti.
Ažurira se nakon svake promjene.

## 2026-11-12 — Popravak: vozila se nisu pomicala u pregledu

**Što:** Preview poslužitelj je radio u `--replay` načinu koji je svaki ciklus
slajao ISTU snimljenu poziciju vozila → markeri se nisu micali. Živi ZET
GTFS-RT feed je provjeren i RADI (79 KB, ~312 vozila; route 14 potvrđena).
Dodano:
- `server/server.py` — `advance_position()` + replaj sada simulira kretanje
  (vozila napreduju uz zabilježeni smjer ~35–80 m/ciklus, uz malu jitter).
- `tests/test_server.py` — test kretanja (sjever/istok/None smjer).
- Preview pokrenut u **živom načinu** (`server.server` bez `--replay`): vozila
  se pomiču (potvrđeno: vozilo route 14 prešlo 128,6 m između dvaju okvira;
  feed napreduje svakih ~10 s). Živi statični GTFS služi se pod istim ključem
  kao i fixture (`3e2a885…`) — što potvrđuje da su snimljeni fixtureji trenutačni.
**Zašto:** korisnički zahtjev "vehicles are not moving".
**Kako provjeriti:** `node /tmp/ws-move.mjs` (2 okvira, >2 m = kreću se);
otvori http://127.0.0.1:5000/ i gledaj markere.

# Dnevnik promjena (CHANGES)

Svaki značajan korak: datum, što, koji datoteke, zašto, kako provjeriti.
Ažurira se nakon svake promjene.

## 2026-11-12 — Početak: REA dokazi i analiza izvora

**Što:** Kloniran `ikicic/zet` u `upstream-zet/` (read-only), pročitan cijeli
izvorni kod (webserver, fetcher, news, client Data/Map/Filter/News/Stale).
REA: `list_browser_targets` + `inspect_web_page` na zet.skoljka.org i
privacy.html (evidence u `docs/00-REA-EVIDENCE.md`). Snimljen live bundle i
dva živa WS okvira (`testdata/`). `analyze_web_bundle` je premašio 60 s i
oborio REA poslužitelj ("Not connected") — zabilježeno.
**Zašto:** faza 1 prema uputama (REA dokazi).
**Kako provjeriti:** `docs/00-REA-EVIDENCE.md`.

## 2026-11-12 — Kodek + testovi (faza 2)

**Što:** `server/codec.py` (referenca 45.815/15.9819, 6 znamenki, delta
encoding, vremenske razlike) + `tests/test_codec.py` (round-trip poznatih
koordinata, regresija na živom okviru route 208). 8 testova prolaze.
**Zašto:** najlakše je pogriješiti baš kodek; testovi ga zaključavaju.
**Kako provjeriti:** `.venv/bin/python -m unittest tests.test_codec -v`.

## 2026-11-12 — Poslužitelj (faza 3)

**Što:** `server/state.py` (RealtimeState, trajektorije, smjer, reportDelay,
v0/v1/v2), `server/staticdata.py` (GTFS zip → komprimirane poruke),
`server/news.py` (RSS + app obavijesti, sanitizacija), `server/transports.py`
(asyncio HTTP+RFC6455 WS), `server/server.py` (GtfsServer: dohvat, klijenti,
rute, replay). `tests/test_state.py`, `tests/test_server.py`.
**Zašto:** jedna procesna arhitektura prema ARHITEKTURI.
**Kako provjeriti:** pokrenuti `--replay` i curl/ws provjere iz BUILD.md;
`.venv/bin/python -m unittest discover -s tests`.

## 2026-11-12 — Frontend (faza 4)

**Što:** `web/` React+TS+Vite+MapLibre: mapa (15.9819/45.815, zoom 12,
minZoom 9, maxZoom 18), slojevi vozila, odabir vozila + trasa + popup
kašnjenja, filter (Tramvaji/Autobusi, tri-state, Reset, localStorage),
geolokacija, Informacije (neslužbena napomena, izvori), Obavijesti (badge,
localStorage), indikator starosti, privacy.html, feedback stub.
**Zašto:** paritet ponašanja s opaženim servisom.
**Kako provjeriti:** `cd web && npm run build`; otvori `http://127.0.0.1:5000/`
uz pokrenut poslužitelj; tipke Filtar/Informacije/Obavijesti rade.

## 2026-11-12 — Dokumentacija (faza 5, prvi prolaz)

**Što:** `docs/00-REA-EVIDENCE.md`, `docs/ARCHITECTURE.md`,
`docs/PROTOCOL.md`, `docs/BUILD.md`, `docs/DEVIATIONS.md`,
`docs/ATTRIBUTION.md`, `README.md`, `LICENSE`, `.gitignore`,
`app_news.example.json`, `requirements.txt`.
**Zašto:** dokumentacija je dio definicije završetka.
**Kako provjeriti:** svaki md odgovara kodu; naredbe iz BUILD.md su kopiraj-zalijepi.

## 2026-11-12 — Provjera završetka

**Što:** Cijeli testni set prolazi (16 testova). Frontend se u headless
pregledniku pokreće: canvas karte prisutan, nema pogreške karte, tipke
Filtar/Informacije/Obavijesti/geolokacija/zoom prisutne (DOM provjera).
**Zašto:** "done" kriteriji.
**Kako provjeriti:** naredbe iz BUILD.md od čiste instalacije.
