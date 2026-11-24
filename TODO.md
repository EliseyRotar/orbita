# TODO

Stato al 24 novembre 2026. Fiera: venerdì 27 e sabato 28 novembre.

## Fatto

- [x] Server Node: HTTP per TV/operatore, HTTPS autofirmato per i visori, WebSocket con riconnessione
- [x] Archivio partite su JSON con scrittura atomica, classifica del giorno e di tutta la fiera
- [x] Gioco three.js unico per PC, telefono, VR e AR (asteroidi che si dividono, combo, 5 potenziamenti, boss con mine)
- [x] HUD e schermate dentro la scena 3D che seguono lo sguardo (visori)
- [x] Il visore resta in VR/AR tra una partita e l'altra
- [x] Dashboard TV: classifica, partite live, statistiche, migliore per dispositivo, feed eventi, QR della scuola, record a schermo intero
- [x] Pannello operatore: assegna nome, coda, termina partita, rinomina/elimina partite, messaggi sulla TV, PIN opzionale
- [x] Test su regole di gioco e archivio; prova end-to-end su PC; VR e AR provati con l'emulatore IWER

## Da fare prima della fiera (priorità alta)

- [ ] **Provare sul Quest 2 vero**: certificato, ingresso in VR, grilletto, fluidità
- [ ] **Provare su un HoloLens 2 vero**: Edge + WebXR in AR, pizzico, leggibilità dell'HUD, fluidità
- [ ] Bilanciare la difficoltà con qualche compagno: la prima partita di un ragazzo dovrebbe durare 1–3 minuti
- [ ] Verificare quanti dispositivi accetta l'hotspot del telefono che useremo
- [ ] Mettere il link giusto nel QR della TV (`config.json` → `qrUrl`), es. la pagina dell'indirizzo Informatica
- [ ] Decidere se mettere un PIN al pannello operatore (`config.json` → `adminPin`)

## Idee se avanza tempo

- [ ] Musica di sottofondo (attenzione alle licenze) e vibrazione dei controller del Quest quando si colpisce
- [ ] Mirino magnetico leggero per chi non ha mai usato un visore
- [ ] Modalità "sfida": due postazioni partono insieme e la TV mostra il testa a testa
- [ ] Grafico sulla TV delle partite per ora
- [ ] Esportare la classifica finale in CSV per il sito della scuola
- [ ] Menu iniziale con scelta della navicella come nella versione Pygame
