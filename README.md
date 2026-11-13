# ZET uživo

**ZET uživo** prikazuje uživo položaje ZET tramvaja i autobusa na karti
Zagreba. Potpuno je **neslužbena aplikacija, neovisna o ZET-u** i nije povezana
sa stranicom zet.skoljka.org („Školjka").

Ovo je samostalno napisan projekt koji reproducira ponašanje javnog servisa
`ikicic/zet` (BSD-3-Clause) — vidi `docs/DEVIATIONS.md` za sve razlike u
odnosu na izvor, `docs/00-REA-EVIDENCE.md` za dokaze istraživanja i
`docs/ATTRIBUTION.md` za podatkovne licence.

## Što jest

- Karta Zagreba u punom zaslonu (MapLibre GL JS) sa **živim položajima**
  tramvaja i autobusa koji šalju GPS.
- Broj linije na oznaci vozila i kratki trag nedavnih pozicija.
- Klik na vozilo: prikaz linijske trase i kašnjenja vozila; klik na praznu
  kartu poništava odabir.
- Filter: Tramvaji / Autobusi / pojedine linije, upravljanje stanjem u
  lokalnoj pohrani.
- Geolokacija korisnika (uz izričitu dozvolu preglednika).
- Informacije o izvorima, privatnosti i licencama; crvena napomena da aplikacija
  **nije ZET**.
- ZET obavijesti s oznakom nepročitanog sadržaja u lokalnoj pohrani.
- Indikator starosti podataka ako feed kasni.

## Što nije

Nije službena aplikacija ZET-a, nije zet.skoljka.org, ne prikuplja podatke o
korisnicima, ne koristi kolačiće ni alate za praćenje.

## Pokretanje

Pogledajte [`docs/BUILD.md`](docs/BUILD.md) (naredbe su spremne za kopiranje):
instalacija, razvoj / test / produkcija, portovi, te kako provjeriti da vozila
stignu.

Kratko:

```sh
# 1) pozadinski poslužitelj (HTTP + WebSocket + dohvaćanje GTFS podataka)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m server.server

# 2) u drugom terminalu, frontend u razvoju
cd web
npm install
npm run dev
# otvori http://localhost:5173/
```

## Licenca

Kod je pod BSD-3-Clause licencom (vidi `LICENSE`). Podaci o vozilima i
voznom redu dolaze od ZET-a pod Otvorenom dozvolom; kartografski podaci od
OpenFreeMap / OpenMapTiles / OpenStreetMap. Detalji: `docs/ATTRIBUTION.md`.
