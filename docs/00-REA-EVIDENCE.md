# REA dokazi (evidence) za ZET uživo

Dokument bilježi što je REA (Reverse Engineering Agent) vratio tijekom
istraživanja, s jasnom podjelom na **opažanja** (observation), **zaključke**
(inference) i **nepoznanice** (unknown). Ažurira se nakon svake značajne
promjene.

> Postupak prema uputama: *"Use the REA MCP. Do not invent tools. If a tool is
> not in the catalog, skip it and say so."*

## 1. Zahtijevani MCP prompti koji NISU u katalogu (preskočeni)

- `investigate_feature` — nije u katalogu dostupnih alata → preskočeno.
  Umjesto toga korišteni su `trace_feature`-ekvivalenti ručno (grep na
  snimljenom bundleu + čitanje izvornog koda).
- `audit_residual_unknowns` — nije u katalogu → preskočeno. Korišten je
  `list_unknowns`-ekvivalent ručno; nepoznanice su zadržane u ovom dokumentu.

## 2. REA pozivi koji su USPIJELI

| # | Alat | Ulaz | Rezultat | Ograničenje |
|---|------|------|----------|-------------|
| 1 | `list_browser_targets` | CDP http://127.0.0.1:9222 (headless Chrome) | ev_413928994c6d3a6fefaa8d9ead1d1b65b18179de909ce89fd4abdf86515f208b — preglednik Chrome/157, popis ciljeva | "prior network and console activity is unavailable" |
| 2 | `inspect_web_page` | https://zet.skoljka.org/ | ev_a56fbfa2a6b345d72137bb9c923286ebcfb853346214bd6a10256887db4afc57 — naslov **"ZET uživo - neslužbena aplikacija"**, bundle `bundle.bf1e09f99947b8b45a25.js` (1 231 493 B), localStorage ključ `zet-news-seen-version-v1`, konzola "WebSocket connection established" | WebSocket connections prazni zbog `attach_limited` (REA se spojila nakon što je WS već bio otvoren) |
| 3 | `inspect_web_page` | https://zet.skoljka.org/privacy.html | ev_aec5b9cfe0f328ec694ac2d8cfe40055363eea19097f15b8d5332e98d90e2146 — naslov "Pravila privatnosti – ZET uživo"; tekst o kolačićima/praćenju/OpenFreeMap | — |

## 3. REA pozivi koji SU OTKAZALI / NISU IZVEDENI

| Alat | Status | Razlog / bilješka |
|------|--------|-------------------|
| `analyze_web_bundle` (live cilj) | timeout | MCP zahtjev prekoračio 60 s; nakon toga je REA CDP pružatelj počeo vraćati `Not connected` do kraja sesije |
| `analyze_javascript_application` (./upstream-zet/web) | nije izveden | REA poslužitelj `Not connected` (nakon gornjeg timeouta) |
| `inspect_analysis_view`, `trace_application_feature` | nisu izvedeni | isto |
| `reconcile_javascript_runtime` | nije izveden | isto |
| `verify_reconstruction` | nije izveden | isto — zamjena ručno (donji odjeljak 6) |
| `list_unknowns` / `record_unknown` | nisu izvedeni | isto — nepoznanice u ovom dokumentu |

Navedeni alati nisu "izmišljeni": nalaze se u REA katalogu, ali ih nije bilo
moguće pokrenuti jer je poslužitelj prestao odgovarati. To se bilježi kao
**ograničenje**, ne kao zaključak.

## 4. Opažanja (observation) — što je REA/izvor potvrdio

- Živi naslov: "ZET uživo - neslužbena aplikacija"; jedan webpack bundle.
- Bundle (snimljen lokalno: `testdata/live-bundle.bf1e09f99947b8b45a25.js`,
  SHA-256 `f59deed4405795c890f3cb1c21e1752bd9205429ce24e6fe2a20387a4208e8d8`):
  - povezuje se na `/ws-v4` (samo taj put; nema /ws, /ws-v1..v3 u klijentu),
  - dohvaća `/static/big/v1/` i `/static/small/v0/`,
  - oznake: "Filtar", "Obavijesti", "Informacije", "Tramvaji", "Autobusi",
    "Reset", "Zadnji podaci: prije …", "neslužbena aplikacija, neovisna o ZET-u",
  - localStorage ključevi: `zet-filter-state`, `zet-location-tracking-enabled`,
    `zet-news-seen-version-v1` (+ legacy `zet-news-snapshot-v1`, `zet-news-seen-v1`),
  - konstante: središte `[15.9819, 45.815]`, zoom 12, minZoom 9, maxZoom 18,
    `coord_num_digits`, `ref_lat`, `ref_lon` prisutni.
- Živi WebSocket `/ws-v4` (samo za čitanje, jedna veza, 2 okvira; snimljeno u
  `testdata/realtime-frame-0.json` i `testdata/news-status-frame.json`):
  - okvir 0: `{"vehicles":{routeIds, shapeIds, vehicleIds, tripIds, blockIds,
    timestamps, reportDelays, compressedLats, compressedLons,
    directionDegrees}, "timestamp":…, "activeStaticKey":"…"}` — **v2 oblik,
    bez `latestStaticKey`** (357 vozila, 10 polja u `vehicles`).
  - okvir 1: `{"type":"news-status","version":"…","latestAt":…}` (16 heks
    znamenki verzije).
- Javni HTTP (pojedinačni GET-ovi, za fixture): `/static/small/v0/<key>` (608 B,
  `{"routes":{"ids":[…]}}`), `/static/big/v1/<key>` (710 520 B, 538 linija,
  2526 stop-delta), `/news?schema=2` (prava ZET obavijest, npr. "Izmjene na
  noćnim tramvajskim linijama").
- Dešifriranje prvog vozila iz okvira 0 (route 208, shape 208_6) daje
  realističan trag u Zagrebu (lat ≈ 45.8493–45.8530, lon ≈ 16.0445–16.0497).


## 5. Zaključci (inference) — izvedeni iz koda i opažanja

- Tramvaj vs autobus: **pravilo iz `web/src/Filter.tsx` (ikicic/zet) — tramvaj
  je linija s brojem/oznakom duljine ≤ 2 znaka** (`routeId.toString().length < 3`).
  Potvrđeno u live bundleu (nema direktne potvrde u okvirima; okviri ne nose
  vrstu vozila). Zaključak se temelji na izvornom kodu + dosljednom ponašanju
  klijenta; primijenjeno je točno to pravilo (vidi `web/src/FilterOverlay.tsx`,
  `web/src/mapLayers.ts` `isTram`).
- Pragovi starosti: klijent prikazuje indikator nakon **30 s** (kritično
  **180 s**) — `web/src/StaleDataIndicator.tsx`; poslužitelj upozorava na
  starost nakon **120 s** — `zet/webserver/webserver.py` (STALE_THRESHOLD=120).
  Primijenjeno isto (server 120 s u `server/server.py`, klijent 30/180 s).
- Živi klijent koristi `/ws-v4` i v2 oblik poruke; ZET uživo stoga implementira
  v2 kao primarni oblik (v0/v1 radi kompatibilnosti).

## 6. Ručna zamjena za `verify_reconstruction` (ograničenje)

Budući da REA `verify_reconstruction` nije bio dostupan, usporedba je
obavljena ručno i *sačuvana u kodu*:

- **Kodek**: `tests/test_codec.py` — okrugli prolaz poznatih koordinata +
  regresijski test dešifriranja snimljenog okvira (route 208) — prolazi.
- **Poslužitelj**: `tests/test_server.py` + `tests/test_state.py` — v1/v2 oblik,
  v0 lista, kašnjenja — prolazi (16 testova ukupno).
- **Ponašanje**: `server/server.py --replay` emitira okvir koji po ključevima i
  strukturi odgovara snimljenom produkcijskom okviru (provjereno ws klijentom).
- Frontend se pokreće i prikazuje kartu + kontrole (potvrđeno DOM-om u
  headless pregledniku: `maplibregl-canvas` prisutan, nema `.map-unavailable`,
  tipke Filtar/Informacije/Obavijesti/geolokacija/zoom prisutne).

## 7. Nepoznanice (unknown) — otvorene

- `unk-01` (medium): REA `analyze_javascript_application` /
  `trace_application_feature` / `reconcile_javascript_runtime` nisu se mogli
  pokrenuti; statička analiza frontenda temelji se na ručnom čitanju izvora i
  grepu živog bundlea, a ne na REA grafu. Dok REA ne bude dostupan, postoji
  rizik da je neki manji tok (npr. obrada rubnih poruka u WS porukama) propušten.
- `unk-02` (low): live `/ws-v4` nije opažen tijekom potpune REA `capture_browser_scenario`
  (pružatelj pao); WS okviri snimljeni neovisnom skriptom (1 veza, 2 okvira) —
  nije potvrđen dugotrajni tok poruka (ponovno spajanje, backoff).
- `unk-03` (low): hoće li Vite dev-proxy propustiti WebSocket u novijim
  verzijama (trenutno nije propuštao; dev WS ide izravno na 127.0.0.1:5000).
- `unk-04` (low): stvarna dostupnost ZET RSS/GTFS s proizvoljnih mreža (kod
  tolerira izostanak; u testovima se koriste fixtureji).

> Ne izmišljamo zatvorene zaključke: gdje REA nije odgovorila, pišemo da nije
> odgovorila.

