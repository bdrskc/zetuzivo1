# ZET uživo protokol

Ovaj dokument opisuje poruke i kompresiju koje koristi ZET uživo. Format je
identičan opaženom ponašanju javnog projekta `ikicic/zet` i živog web servisa
`zet.skoljka.org` (vidi `docs/00-REA-EVIDENCE.md` i `docs/DEVIATIONS.md`).

## Verzija

Implementirana je **trenutačna verzija klijenta: WebSocket ruta `/ws-v4` s
v2 oblikom realtime poruke** (bez `latestStaticKey`). Živi `/ws-v4` šalje upravo
taj oblik (snimljeno u `testdata/realtime-frame-0.json`). Radi kompatibilnosti
poslužitelj nudi i:

- `/ws` → v0 (lista vozila, "stari" oblik),
- `/ws-v1` → v1 (struktura polja + `latestStaticKey`),
- `/ws-v2` → v2 (kao v1 bez `latestStaticKey`),
- `/ws-v3` → v2 + `news-status` (schema v1),
- `/ws-v4` → v2 + `news-status` (schema v2), opcijski `?appUpdates=1`.

## Kompresija koordinata

- Referentni sustav: `ref_lat = 45.815`, `ref_lon = 15.9819`,
  `coord_num_digits = 6` (pomaci u mikrostupnjevima).
- Apsolutni pomak: `round((v - ref) * 10^6)`; zatim **delta-encoding**
  (razlike uzastopnih vrijednosti).
- Dekodiranje: akumuliraj delte pa `ref + acc * 1e-6`.
- Vremena vozila: `delta = feed_timestamp - vehicle_timestamp` (sekunde prije
  vremena poruke).
- `stopIndexDeltas` (velika poruka): delta-encoded indeksi stanica u globalnoj
  tablici stanica.

Round-trip je pokriven testovima u `tests/test_codec.py`, uključujući
dešifriranje snimljenog produkcijskog okvira.

## Primjer okvira (v2, snimljeno s /ws-v4)

```json
{
  "vehicles": {
    "routeIds": [208, 109, 5, 109, 269, ...],
    "shapeIds": ["208_6", "109_3", "5_17", "109_2", "269_15", ...],
    "vehicleIds": ["368", "3515", "3526", ...],
    "tripIds": ["...", "...", ...],
    "blockIds": ["1102", "1208", ...],
    "timestamps": [9, 1, 6, ...],
    "reportDelays": [9, 1, 6, ...],
    "compressedLats": [[34250, 1042, ...], ...],
    "compressedLons": [[...], ...],
    "directionDegrees": [-39, null, 10, ...]
  },
  "timestamp": 1794469475,
  "activeStaticKey": "3e2a885ef97a6d9f503bdb0b3fd2a6d2"
}
```

`shapeIds[i]` je `"<linija>_<indeks>"`, npr. `"208_6"`. `directionDegrees` je
smjer u stupnjevima (0 = sjever, 90 = istok), `null` kad nema dovoljno tragova.
`reportDelays` može izostati na starijim poslužiteljima (klijent to tolerira).

### Što stvarno sadrži živi GTFS-RT feed (snimljeno 2026-11-12)

Jedna `FeedMessage` s `https://www.zet.hr/gtfs-rt-protobuf` (~80 KB, ~860
entiteta) sadrži **oba tipa** poruka:

- **VehiclePosition: ~319** — pozicija + `timestamp` (svaka ima `timestamp`),
  ali **nema** `current_stop_sequence` ni `stop_id`.
- **TripUpdate: ~541** — svaka s `timestamp`; **540** imaju `stop_time_update`
  (ukupno ~633; **~320 s arrival.time**, **~617 s departure.time**; neke nose i
  `arrival.delay`/`departure.delay`). **TripUpdate.delay nije postavljen**
  (0/541).

Primjer STU: stop_id `"371_24"`, seq 15, `arrival.time` (epoch) i
`arrival.delay = 37`. Zaključak: feed podržava 1. razinu procjene (per-stanica
`arrival.time` / `arrival.delay`), nema feed-razinske `delay` (2. razina), a
`current_stop_sequence` nije dostupan, pa se "je li vozilo prošlo stanicu"
računa iz pozicije duž vožnje.

### `tripUpdates` (ZET uživo proširenje, samo u v2)

Realno vrijeme u v2 (ruta `/ws-v4`) opcionalno nosi `tripUpdates`: niz
dešifriranih TripUpdatea — `{tripId, delay?, timestamp?, stopTimeUpdates:
[{stopId, seq?, arrivalTime?, arrivalDelay?, departureTime?, departureDelay?}]}`.
v0 i v1 ostaju nepromijenjeni (upstream-oblik); `tripUpdates` je dodatni ključ
koji stari klijenti ignoriraju. U v2 se šalju samo TripUpdatei čija vožnja
trenutačno ima vozilo na karti (ostali ne ulaze u procjenu dolaska).

## Statične poruke

- `GET /static/small/v0/<key>` → `{"routes":{"ids":[...]}}` (mala, učitava se
  odmah).
- `GET /static/big/v1/<key>` → `{"shapes":{"ids":[...],"compressedLats":[...],
  "compressedLons":[...],"stopIndexDeltas":[...]},"stops":{"latDeltas":[...],
  "lonDeltas":[...]}}` (velika, učitava se pri odabiru vozila).
- `GET /static/stops/v1/<key>` → sve stanice iz `stops.txt`, bez stop_times:
  `{"date": "...", "stops": [[stop_id, name, lat, lon, [route_ids...]], ...]}`.
  Identitet stanice (id/ime/koordinate + linije koje je opslužuju) dolazi iz
  statičnog GTFS-a, ne iz koordinata-only payloada.
- `GET /static/stop/v1/<key>/<stop_id>` → mali payload za jednu stanicu:
  `{"stopId","name","lat","lon","services":[{tripId,routeId,headsign,
  directionId,shapeId,times:[[stopId,seq,arrivalSec,departureSec],...]}]}`
  — sve aktivne vožnje danas (Europe/Zagreb) koje staju na stanicu; `times` je
  cijela vožnja u `stop_sequence` redoslijedu. `stop_id` je URL-kodiran.
  Klijent sprema ovaj mali payload po stanici i osvježava procjene na svaku
  novu realtime poruku — bez HTTP-anja svake sekunde.
- `<key>` = SHA-256 heks zipa statičnog GTFS-a; mijenja se kad ZET objavi novi
  voznog reda. `activeStaticKey` u realtime poruci kaže koji je trenutačno aktivan.

## Procjena dolaska na stanicama

Redoslijed razina (prva koja vrijedi pobjeđuje), s naznakom izvora u UI samo
kad nije `live`:

1. **Live** — TripUpdate `stop_time_update` za taj `stop_id` (`arrival.time`,
   inače planirano vrijeme + `arrival.delay`); samo ako vozilo još nije prošlo
   stanicu (pozicija duž vožnje; feed nema `current_stop_sequence`).
2. **Live** — TripUpdate `delay` (feed-razinski) na planirano vrijeme iz
   `stop_times.txt`; isto samo ako je vozilo još uzvodno.
3. **Procjena** — udaljenost duž niza stanica (ne cijele GTFS trase) podijeljena
   brzinom: zadnja dva GPS uzorka, pomiješana s planiranim tempom te dionice.
   Vozilo koje stoji na semaforu ne daje više procjenu od pola sata. Ako je
   TripUpdate u prošlosti, a vozilo je još prije stanice, ili je kašnjenje
   nevjerojatno za preostale stanice, koristi se ova razina. U retku piše
   "procjena". Položaj na petlji traži se oko stanice na kojoj bi vozilo po
   voznom redu trebalo biti, ne po cijeloj trasi.

Vozni red (timetable) se **ne** prikazuje — na stanicama su samo žive lokacije
procjenjive u minutama. Prikazuju se samo vozila koja su **do 10 stanica prije
odabrane stanice** (na istoj vožnji); vozila koja su dalje ili su već prošla
stanicu se odbacuju, pa nema procjena od sati vremena. Kad feed zastari,
redovi ostaju prikazani (zadnja dobra snimka) uz postojeći indikator starosti,
bez odbrojavanja.

Format retka: broj linije, smjer, pa minute ("sada" ispod minute, inače
"3 min"). Uživo nosi i planirano vrijeme. Za istu liniju i isti smjer ostaje
samo najbliži dolazak. Odbrojavanje ide po satu preglednika, ne po
zaleđenom vremenu feeda.


## Obavijesti

- WebSocket, na spajanje za v3+: `{"type":"news-status","version":"<16 heks>",
  "latestAt":<epoch s|null>}`.
- `GET /news?schema=2` (v2 uključuje `app` obavijesti) →
  `{"type":"news","version":"<16 heks>","fetchedAt":<s>,
  "items":[{"id","kind":"traffic|news|app","publishedAt","title",
  "summaryHtml","url"}]}`. Podrška ETag/304; 204 kad nema obavijesti.
- Klijent pamti posljednju pročitanu verziju u localStorage
  (`vozlinija-news-seen-version-v1`) i prikazuje točkicu za nepročitano.
- `summaryHtml` je sanitiziran na poslužitelju (dopuštene oznake
  strong/b/em/i/br/p/ul/ol/li); klijent dodatno validira prije prikaza.

## Pragovi starosti

- Poslužitelj: upozorenje ako nema realtime ažuriranja **120 s**
  (`server/server.py`, `REALTIME_STALE_THRESHOLD = 120`).
- Klijent: indikator se prikazuje nakon **30 s**, crven nakon **180 s**
  (`web/src/StaleDataIndicator.tsx`); markeri vozila blijede prema sivoj od
  75 s do 90 s kašnjenja (`STALE_FADE_START/END`).

## Povratne informacije

- `POST /api/feedback` → lokalni stub: uvijek 501 s porukom na hrvatskom; ništa
  se ne šalje niti pohranjuje (vidi `docs/BUILD.md`).
