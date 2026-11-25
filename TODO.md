# TODO

Stato al 24 novembre 2026. Fiera: venerdì 27 e sabato 28 novembre.

## Fatto

- [x] Server Node: HTTP per monitor/operatore, HTTPS autofirmato per i visori, WebSocket con riconnessione
- [x] Archivio partite su JSON con scrittura atomica, classifica del giorno e di tutta la fiera
- [x] Gioco three.js unico per PC, telefono, VR e AR
- [x] Modelli 3D Kenney (meteoriti, cristalli, 3 navicelle nemiche, boss, piattaforma), cielo NASA della Via Lattea
- [x] Navicelle nemiche che sparano plasma abbattibile; boss ogni 3 ondate
- [x] Pistola laser 3D in mano sul Quest, allineata al raggio di mira
- [x] Effetti sonori Kenney e due brani CC0 (attesa e partita, più veloce durante il boss)
- [x] HUD e schermate pixel-art dentro la scena 3D che seguono lo sguardo (visori)
- [x] Monitor classifica in stile Cabinato: HIGH SCORES, postazioni live, numeri, sfida tra dispositivi, QR, record a tutto schermo
- [x] Monitor spettatore 3D: segue in automatico la partita migliore, si può scegliere la postazione
- [x] Pannello operatore: nomi, coda, termina partita, rinomina/elimina, messaggi sul monitor, PIN opzionale
- [x] Design su Claude Design (3 direzioni, scelta "Cabinato", schermate di gioco/game over/spettatore)
- [x] Test su regole e archivio; prove end-to-end su PC; VR e AR provate con l'emulatore IWER
- [x] Lista materiale e messaggio per l'ufficio tecnico ([docs/MATERIALE.md](docs/MATERIALE.md))
- [x] Pausa (pulsante, P/Esc, tasto laterale del Quest); visore tolto o telefono bloccato = pausa, poi chiusura con punteggio salvato
- [x] Niente più postazioni "fantasma" in partita: il server chiude da solo le partite senza segnale (60 s)
- [x] Difficoltà dal pannello operatore: 4 livelli pronti + 5 cursori; boss a 3 fasi con scudo e scorta
- [x] Tre stili grafici (neon, realistico, ologramma) scelti per PC/telefono, Quest e HoloLens
- [x] Quest: tabellone "altri piloti in volo" e navicelle fantasma degli altri giocatori
- [x] Pannello operatore rifatto (schede, stato e ultimo segnale, azzera stato, comandi per tutti, CSV)
- [x] Classifica con tutti (telefoni compresi), un nome per giocatore, a pagine; nome obbligatorio dal telefono
- [x] Spettatore: vista singola (alle spalle o in soggettiva) con scheda tecnica, griglia con tutte le partite

## Da fare prima della fiera (priorità alta)

- [ ] **Provare sugli HoloLens 2 veri** (ne avete 4 ora): ingresso in AR, pizzico, leggibilità HUD, fluidità con i modelli 3D
- [ ] **Provare sul Quest 2 vero**: pistola in mano, grilletto, fluidità, volume della musica
- [ ] Mandare la richiesta all'ufficio tecnico (monitor, cavi, portatile, **router**)
- [ ] Prova con 8 dispositivi insieme sulla rete che userete (l'hotspot dell'iPhone potrebbe non bastare)
- [ ] Bilanciare la difficoltà con qualche compagno: una prima partita dovrebbe durare 1–3 minuti
- [ ] Mettere il link giusto nel QR (`config.json` → `qrUrl`), es. la pagina dell'indirizzo Informatica
- [ ] Decidere se mettere un PIN al pannello operatore (`config.json` → `adminPin`)

## Idee se avanza tempo

- [ ] Mirino magnetico leggero per chi non ha mai usato un visore
- [ ] Modalità "sfida": due postazioni partono insieme e lo spettatore mostra il testa a testa
