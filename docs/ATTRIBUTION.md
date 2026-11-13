# Zasluge i licencije (ATTRIBUTION)

ZET uživo je samostalno napisan projekt koji reproducira ponašanje javnog
projekta **"ZET live map"** i njegovog web servisa. Ovaj dokument navodi sve
izvore, licence i obveze zadržavanja obavijesti o autorskim pravima.

## Upstream projekt (kod i ponašanje)

- Projekt: **ikicic/zet — "ZET live map"**
- URL: https://github.com/ikicic/zet
- Autor: Ivica Kičić (GitHub: ikicic)
- Licenca: **BSD-3-Clause** (Copyright (c) 2025, ikicic)

ZET uživo reproducira opaženo ponašanje i format poruka tog projekta (kodek,
WS protokol, GTFS statične poruke, obavijesti, pragovi starosti, pravilo
tramvaj/autobus). Novi kod je napisan za ZET uživo i licenciran je pod
BSD-3-Clause uz zadržavanje gornje obavijesti (vidi `LICENSE`). Klon
`upstream-zet/` u ovom repozitoriju je **read-only referentna kopija** i ne
mijenja se (u `.gitignore`).

## Podaci o vozilima i voznom redu (ZET)

- Otvorena dozvola (data.gov.hr): https://data.gov.hr/otvorena-dozvola
- ZET GTFS (statični podaci): https://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669
- ZET GTFS-Realtime (protobuf): https://www.zet.hr/gtfs-rt-protobuf

Aplikacija koristi podatke tijela javne vlasti u skladu s Otvorenom dozvolom.

## Kartografija

- **MapLibre GL JS** (interaktivna karta): https://maplibre.org/ (BSD-3-Clause / ISC)
- **OpenFreeMap** (podloge): https://openfreemap.org/
- **OpenMapTiles**: https://openmaptiles.org/
- **OpenStreetMap** (izvor podataka): https://www.openstreetmap.org/

Kartografske podloge učitavaju se iz OpenFreeMap-a (`tiles.openfreemap.org`),
koji koristi OpenMapTiles shemu i OSM podatke; pripis (attribution) prikazuje
MapLibre kontrola za pripis.

## Obavijesti

ZET obavijesti dohvaćaju se s `https://www.zet.hr/rss_promet.aspx` i
`https://www.zet.hr/rss_novosti.aspx` (sadržaj pripada ZET-u).

## Napomena o robnoj marki

"ZET" je robna marka Zagrebačkog električnog tramvaja. Aplikacija se zove
ZET uživo, ali nije povezana sa ZET-om niti sa zet.skoljka.org i nije službena.
Imena i logotipi trećih strana vlasništvo su njihovih vlasnika.
