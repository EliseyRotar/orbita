# TODO

Stato al 24 novembre 2026. Fiera: venerdì 27 e sabato 28 novembre.

## Fatto

- [x] Server Node: HTTP per monitor/operatore, HTTPS autofirmato per i visori, WebSocket con riconnessione
- [x] Archivio partite su JSON con scrittura atomica, classifica del giorno e di tutta la fiera
- [x] Gioco three.js unico per PC, telefono, VR e AR
- [x] Modelli 3D Kenney (meteoriti, cristalli, 3 navicelle nemiche, boss, piattaforma), cielo NASA della Via Lattea
- [x] Navicelle nemiche che sparano plasma abbattibile; boss ogni 4 ondate
- [x] Pistola laser 3D in mano sul Quest, allineata al raggio di mira
- [x] Effetti sonori Kenney e due brani CC0 (attesa e partita, più veloce durante il boss)
- [x] HUD e schermate pixel-art dentro la scena 3D che seguono lo sguardo (visori)
- [x] Monitor classifica in stile Cabinato: HIGH SCORES, postazioni live, numeri, sfida tra dispositivi, QR, record a tutto schermo
- [x] Monitor spettatore 3D: segue in automatico la partita migliore, si può scegliere la postazione
- [x] Pannello operatore: nomi, coda, termina partita, rinomina/elimina, messaggi sul monitor, PIN opzionale
- [x] Design su Claude Design (3 direzioni, scelta "Cabinato", schermate di gioco/game over/spettatore)
- [x] Test su regole e archivio; prove end-to-end su PC; VR e AR provate con l'emulatore IWER
- [x] Lista materiale e messaggio per l'ufficio tecnico ([docs/MATERIALE.md](docs/MATERIALE.md))

## Da fare prima della fiera (priorità alta)

- [ ] **Provare sugli HoloLens 2 veri** (ne avete 4 ora): ingresso in AR, pizzico, leggibilità HUD, fluidità con i modelli 3D
- [ ] **Provare sul Quest 2 vero**: pistola in mano, grilletto, fluidità, volume della musica
- [ ] Mandare la richiesta all'ufficio tecnico (monitor, cavi, portatile, **router**)
- [ ] Prova con 8 dispositivi insieme sulla rete che userete (l'hotspot dell'iPhone potrebbe non bastare)
- [ ] Bilanciare la difficoltà con qualche compagno: una prima partita dovrebbe durare 1–3 minuti
- [ ] Mettere il link giusto nel QR (`config.json` → `qrUrl`), es. la pagina dell'indirizzo Informatica
- [ ] Decidere se mettere un PIN al pannello operatore (`config.json` → `adminPin`)

## Idee se avanza tempo

- [ ] Vibrazione dei controller del Quest quando si colpisce qualcosa
- [ ] Mirino magnetico leggero per chi non ha mai usato un visore
- [ ] Modalità "sfida": due postazioni partono insieme e lo spettatore mostra il testa a testa
- [ ] Esportare la classifica finale in CSV per il sito della scuola
