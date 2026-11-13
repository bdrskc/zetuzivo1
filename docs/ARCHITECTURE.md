# Arhitektura ZET uživo

## Pregled

ZET uživo je neslužbena web aplikacija koja prikazuje uživo položaje ZET
tramvaja i autobusa na karti Zagreba. Sastoji se od:

- **jednog Python (asyncio) poslužitelja** (`server/`) koji:
  - dohvaća GTFS-RT protobuf s `https://www.zet.hr/gtfs-rt-protobuf` (svakih
    10 s, s backoff-om kad se podaci ne mijenjaju),
  - dohvaća statične GTFS zip-ove (`https://www.zet.hr/gtfs-scheduled/latest`
    + prethodne s popisa `/gtfs2`), pretvara ih u komprimirane JSON poruke
    (velike: linije+stanice, male: identifikatori linija), ključ = SHA-256
    zipa,
  - drži **RealtimeState** (trajektorije, smjer, `reportDelay`, identitet
    vozila po `(vehicle_id, trip_id)`) i gura nove snimke svim povezanim
    WebSocket klijentima,
  - dohvaća ZET obavijesti (RSS `rss_promet.aspx`, `rss_novosti.aspx` + opcijski
    `app_news.json`), sanitizira HTML, gradi snapshots/status poruke,
  - poslužuje izgrađeni frontend (`web/dist`), statične JSON poruke, `/news` i
    `/api/feedback` (stub),
  - WebSocket rute: `/ws` (v0), `/ws-v1`, `/ws-v2`, `/ws-v3`, `/ws-v4`.
- **React + TypeScript + Vite frontend** (`web/`) s MapLibre GL JS.

```
                    +--------------------------------------------------+
                    |              server/ (jedan proces, :5000)        |
   ZET GTFS-RT  --> |  run_fetch_loop  --> process_feed_bytes           |
   ZET GTFS zip --> |  run_fetch_loop  --> process_static                |
   ZET RSS      --> |  run_news_loop  --> NewsCache                      |
                    |                                                   |
                    |  RealtimeState  --> WsOutputMessageVariants v0/v1/v2 |
                    |       |                |                           |
                    |       v                v                           |
                    |  broadcast_real_time  broadcast_news_status        |
                    |       |                |                           |
                    |  HTTP (HttpMessage)  /ws* (RFC6455)  <-- VozLiniaConnection |
                    +--------------------------------------------------+
                                       | (vite dev proxy za HTTP; WS izravno :5000)
                                       v
                     web/ (React + MapLibre) :5173 (dev) / :5000 (prod)
```

## Zašto ovaj stack

- **Jedan proces umjesto tri** (upstream: fetcher + webserver + frontend dev
  server). Feed, protokol i ponašanje ostaju isti; manje pokretnih dijelova,
  lakše pokretanje i testiranje.
- **Python za poslužitelj**: `gtfs-realtime-bindings` besprijekorno parsira
  GTFS-RT protobuf; logika stanja vozila prenesena je 1:1 prema opaženom
  ponašanju upstream servera.
- **Bez vanjskog HTTP/WS okvira**: `server/transports.py` je mali asyncio
  HTTP + RFC6455 WebSocket transport (jedan priključak za HTTP i WS; podržava
  POST za feedback stub). Manje ovisnosti, potpun nadzor.
- **Vite** umjesto webpacka za frontend (brz dev server, jednostavan build).
  MapLibre GL JS v5 za kartu.

## Moduli (server)

| Modul | Uloga |
|-------|-------|
| `server/codec.py` | Referentni sustav koordinata, delta-encoding, vremenske razlike (čisti, testirani) |
| `server/state.py` | ParsedFeed, Vehicle, RealtimeState (trajektorije, smjer, kašnjenja, v0/v1/v2 JSON) |
| `server/staticdata.py` | Parsiranje GTFS zipa, komprimirane big/small poruke, ključevi; raspored (`ScheduleDb`) se parsira jednom, dnevni indeks je filter |
| `server/news.py` | RSS + app obavijesti, sanitizacija, snapshot/status v1/v2 |
| `server/transports.py` | asyncio HTTP + WebSocket transport (jedna veza) |
| `server/server.py` | GtfsServer: dohvat, stanje, klijenti, HTTP rute, WS rute, replay |

## Moduli (web)

| Modul | Uloga |
|-------|-------|
| `web/src/protocol.ts` | Tipovi poruka i dekompresija (v0/v1/v2, statične poruke) |
| `web/src/AppView.tsx` | Sastavlja karticu: mapa, feed, stanice, filter, obavijesti |
| `web/src/useZagrebMap.ts` | MapLibre karta, geolokacija, slojevi vozila i stanica |
| `web/src/useLiveFeed.ts` | WebSocket `/ws-v4` i petlja crtanja vozila |
| `web/src/useStopBoard.ts` | Stanice, dolasci, trasa odabranog vozila, tražilica |
| `web/src/useNews.ts` | Obavijesti: status, snapshot, nepročitano |
| `web/src/sheets.tsx` | Ploče stanice i vozila, poruka kad karta ne krene |
| `web/src/filterState.ts` | Filter i geolokacija u localStorage |
| `web/src/routeOverlay.ts` | Istaknuta linija odabranog vozila |
| `web/src/vehicleLayers.ts` | MapLibre slojevi vozila (krug+oznaka, trag, strelica, ghost) |
| `web/src/mapLayers.ts` | GeoJSON i izrazi boja (tram/bus, starost, isticanje) |
| `web/src/FilterOverlay.tsx` | Filter (Tramvaji/Autobusi, tri-state, pojedinačne linije, Reset) |
| `web/src/InfoOverlay.tsx` | Informacije, izvori, privatnost, obavijest o neslužbenosti |
| `web/src/NewsOverlay.tsx` | Obavijesti: snapshot tipovi, badge, pregled |
| `web/src/StaleDataIndicator.tsx` | Indikator starosti podataka (30/180 s) |
| `web/src/vehicleAnimation.ts` | Nadoknada kretanja između GPS poruka (bez lijepljenja na trasu) |
| `web/src/eta.ts` | Procjena dolaska na stanicama (GTFS raspored + uživo) |
| `web/src/stops.ts` | Sloj stanica (klasteri) + popup s procjenama |
| `web/src/Feedback.tsx` | Obrazac (stub; onemogućen) |

## Portovi

- Poslužitelj: `127.0.0.1:5000` (HTTP + WebSocket)
- Vite dev server: `127.0.0.1:5173` (`host` je fiksan, ne IPv6 `::1`;
  `strictPort: true`) — otvara se na `http://localhost:5173/` i
  `http://127.0.0.1:5173/`. HTTP i WebSocket idu kroz Vite proxy na `:5000`
  (isti origin). Vidi `docs/DEVIATIONS.md`.

## Podatkovni tijek

1. `run_fetch_loop` dohvaća realtime; `process_feed_bytes` parsira protobuf,
   `process_feed` odabire aktivni statični snapshot prema datumu voznog reda
   (Europe/Zagreb) i ažurira `RealtimeState`.
2. `WsOutputMessageVariants` gradi v0 (lista) i v1/v2 (struktura polja) i
   pamti `latest_message`; pri spajanju klijenta šalje se zadnja poruka (+
   `news-status` za v3+).
3. Svaka nova snimka šalje se svim klijentima (`broadcast_real_time`).
4. Frontend dekomprimira i crta markere/tragove; odabir vozila dohvaća
   `/static/big/v1/<key>` i crta trasu + stanice.
5. `run_news_loop` osvježava obavijesti svakih 300 s i obavještava klijente o
   promjeni (`broadcast_news_status`).

## Replay (razvoj/offline)

`server/server.py --replay` učitava snimljene fixtureje iz `testdata/`
(realtime okvir + statične poruke) i reproducira ih kroz redoviti cjevovod s
pomaknutim vremenom (izgleda živo), pa razvoj ne ovisi o dostupnosti ZET
feedova. Vidi `docs/BUILD.md`.
