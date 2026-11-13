# ZET uživo — build i pokretanje

## Verzije (provjereno)

- Node.js **26.8.x**, npm **11.x**
- Python **3.14.x**
- macOS (darwin); primjenjivo i na Linuxu (naredbe su iste)

## Instalacija

```sh
# 1) Python okruženje (poslužitelj)
cd "/Users/jaman/Documents/zet skoljka"
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2) Frontend ovisnosti
cd web
npm install
cd ..
```

## Pokretanje

### Razvoj (toplo ponovno učitavanje)

```sh
# terminal 1 — poslužitelj (HTTP + WebSocket + feed) s replajem fixtureja
.venv/bin/python -m server.server --replay --host 127.0.0.1 --port 5000

# terminal 2 — Vite dev server
cd web
npm run dev
# otvori http://localhost:5173/
```

Bez `--replay` poslužitelj dohvaća žive ZET podatke:

```sh
.venv/bin/python -m server.server --host 127.0.0.1 --port 5000
```

> **Živi način = vozila se pomiču.** `--replay` (offline) također simulira
> kretanje: vozila napreduju uz zabilježeni smjer ~35–80 m/ciklus, pa i bez
> mreže karta izgleda živo. Ako vozila stoje u pregledu, provjerite da je
> poslužitelj pokrenut u živom načinu (a ne s `--replay` koji je prije
> simulacije kretanja slao fiksne pozicije).

### Produkcija (jedan proces služi sve)

```sh
cd web && npm run build && cd ..
.venv/bin/python -m server.server --host 127.0.0.1 --port 5000
# otvori http://127.0.0.1:5000/
```

## Docker (jedan lagani kontejner)

Karta se izgradi u prvom sloju i odbaci se Node. U kontejneru ostaje samo
Python i gotov `web/dist`. Poslužitelj sluša na `0.0.0.0:5000` i vuče živi
ZET feed.

```sh
docker compose down --remove-orphans
docker rm -f zet-uzivo
docker compose up -d --build
# otvori http://localhost:8787/
```

Ručno, isti port:

```sh
docker build -t zet-uzivo .
docker rm -f zet-uzivo
docker run -d --name zet-uzivo --restart unless-stopped -p 8787:5000 zet-uzivo
```

Na macOS-u port 5000 često drži AirPlay. Ako Docker javi
`failed programming external connectivity`, stari kontejner još drži port:
`docker rm -f zet-uzivo`, pa ponovo `docker compose up -d --build`.
Lijevi broj je port na računalu, desni ostaje 5000 unutar kontejnera.

Port unutar kontejnera mijenja se s `-e VOZLINIA_PORT=8080` i `-p 8080:8080`.

Build piše `web/dist/version.json`; poslužitelj ga objavljuje klijentima s
`?appUpdates=1` (klijent ga ne koristi za auto-refresh — vidi DEVIATIONS).

## Testovi

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
cd web && npm run test:anim && npm run test:eta && cd ..
```

Očekivano: **20 Python testova** (kodek + stanje + poslužitelj + raspored) i
**animacijski + ETA testovi** — svi prolaze.

## Provjera da vozila stižu

```sh
# 1) HTTP živi
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/

# 2) WebSocket — očekuje se prvo velik JSON (vehicles), zatim news-status
node -e '
const ws = new WebSocket("ws://127.0.0.1:5000/ws-v4");
ws.onmessage = (ev) => {
  const t = String(ev.data);
  console.log(t.slice(0, 120));
  ws.close(); process.exit(0);
};
'

# 3) statične poruke
curl -s 'http://127.0.0.1:5000/static/small/v0/3e2a885ef97a6d9f503bdb0b3fd2a6d2' | head -c 120; echo
curl -s -o /dev/null -w 'big: %{http_code} %{size_download}B\n' \
  'http://127.0.0.1:5000/static/big/v1/3e2a885ef97a6d9f503bdb0b3fd2a6d2'

# 4) obavijesti
curl -s -o /dev/null -w 'news: %{http_code}\n' 'http://127.0.0.1:5000/news?schema=2'
```

## Replay / fixtureji

Kad je živi feed privremeno prazan ili nije dostupan, koristite `--replay`:
poslužitelj čita snimljene podatke iz `testdata/` (realtime okvir sa 357
vozila + statične poruke) i reproducira ih s pomaknutim vremenom — karta
izgleda živo, bez mreže.

- `testdata/realtime-frame-0.json` — snimljen produkcijski okvir (v2)
- `testdata/news-status-frame.json` — snimljena news-status poruka
- `testdata/static-small.json`, `testdata/static-big.json` — javni GTFS
  izvedeni podaci
- `testdata/live-bundle.bf1e09f99947b8b45a25.js` — snimljeni live bundle
  (evidencija; ne koristi se u aplikaciji)

## Varijable okruženja

| Varijabla | Učinak |
|-----------|--------|
| `VOZLINIA_HOST`, `VOZLINIA_PORT` | Podrazumijevano `127.0.0.1` / `5000` |
| `VOZLINIA_DEV=1` | Dev ponašanje poslužitelja (povremeno "stari" položaj radi testiranja sivih markera; dev obavijest "Testna obavijest") |
| `VOZLINIA_APP_NEWS_FILE` | Put do opcijske `app_news.json` (obavijesti tipa `app`) |
| `VOZLINIA_FRONTEND_RELEASE_FILE` | Put do `version.json` (drugačije mjesto od `web/dist/version.json`) |
| `VOZLINIA_SMTP_HOST` / `ZET_LIVE_SMTP_HOST` | **Ne uključuju slanje.** Feedback je uvijek 501; ništa se ne sprema (vidi DEVIATIONS) |
| `VOZLINIA_WEB_PORT` | Port Vite dev poslužitelja (zadano 5173) |

Nema tvrdo kodiranih tajni.

## Portovi

- **5000** — poslužitelj (HTTP + WebSocket; rute `/ws-v0..v4`)
- **5173** — Vite dev server

U dev, Vite proksira HTTP rute (`/static`, `/news`, `/api`, `/privacy.html`)
**i WebSocket** (`/ws`, `/ws-v4`, …) na :5000. Stranica i feed dijele origin,
pa radi i s drugog uređaja. Port frontenda je 5173; `VOZLINIA_WEB_PORT` ga
mijenja.
