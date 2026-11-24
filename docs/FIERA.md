# Guida allo stand

Cosa fare per montare Orbita alla Fiera dell'Orientamento e cosa fare se qualcosa non va.

## Turni

| Giorno | Orario | Chi c'è |
| --- | --- | --- |
| Venerdì 27 novembre | 9:00 – 14:00 | Elisey, Federico Poli |
| Sabato 28 novembre | 9:00 – 18:00 | Elisey, Andrea Moretti, Ouertani Mabrouk, (Viola Zanchi) |

I visitatori sono soprattutto ragazzi di terza media con i genitori: spiegazioni brevi, partite veloci,
e quando chiedono "cosa si fa al Marconi?" si indica il QR sulla TV.

## Cosa portare

- [ ] Portatile con Orbita (già testato, `npm install` fatto **a casa**: in fiera internet è lento)
- [ ] Alimentatore del portatile + ciabatta/prolunga
- [ ] Cavo HDMI per la TV (+ adattatore se serve)
- [ ] Meta Quest 2 carico + controller con pile cariche + cavo di ricarica
- [ ] 3 HoloLens 2 carichi + cavi USB-C e caricatori
- [ ] Telefono per l'hotspot + powerbank (l'hotspot consuma tanta batteria)
- [ ] Salviette igienizzanti per i visori
- [ ] Mouse per il PC (si gioca meglio che col touchpad)

## Montaggio (circa 15 minuti)

1. **Hotspot**: accendi l'hotspot del telefono. Collega il portatile, il Quest e gli HoloLens alla stessa rete.
   L'hotspot di molti telefoni accetta al massimo 5–10 dispositivi: portatile + Quest + 3 HoloLens = 5.
2. **Server**: sul portatile, nella cartella `orbita`:
   ```bash
   npm start
   ```
   (se hai cambiato codice: `npm run fiera`, che ricompila prima). Annota l'indirizzo `https://…:8443/` che stampa.
3. **TV**: collega la TV in HDMI, apri `http://localhost:8080/tv` e premi F11 per lo schermo intero.
4. **Operatore**: apri `http://localhost:8080/admin` in un'altra finestra sullo schermo del portatile.
5. **Quest 2**: apri il browser del Quest, vai all'indirizzo `https://…:8443/`, accetta l'avviso del certificato
   (Avanzate → Continua), premi **Entra in VR**. Rimane dentro la VR tra una partita e l'altra.
6. **HoloLens 2**: apri Edge, stesso indirizzo, accetta il certificato, premi **Entra in AR**.
7. Nel pannello operatore rinomina le postazioni (es. "Quest", "HoloLens 1", "HoloLens 2", "HoloLens 3"):
   i nomi compaiono così sulla TV.
8. Fai una partita di prova su ogni visore e controlla che compaia sulla TV.

Se l'IP del portatile cambia (hotspot diverso), riavvia il server: genera un nuovo certificato e sui visori
bisogna riaccettarlo.

## Durante la fiera

1. Un ragazzo arriva: scrivi il suo nome nella postazione libera del pannello operatore e premi Invio.
   Se c'è fila, aggiungi i nomi nella **Coda** e usa "Primo in coda" quando un visore si libera.
2. Mettigli il visore: vede "Tocca a …". Preme il grilletto (Quest) o fa il pizzico (HoloLens) e parte.
3. A fine partita vede punteggio e posizione. Dopo 3 secondi il visore è pronto per il prossimo.
4. Se qualcuno si blocca o deve andare via: **Termina partita** dal pannello (il punteggio viene salvato).
5. Nome inadatto in classifica? **Rinomina** o **Elimina** nelle "Ultime partite".
6. Vuoi annunciare qualcosa sulla TV (es. un incontro)? Usa "Messaggio sulla TV".

Su un PC si può giocare anche direttamente dal browser (mouse), utile quando c'è tanta fila.

## Problemi comuni

| Problema | Cosa fare |
| --- | --- |
| Il visore non trova il server | Controlla che sia sullo stesso hotspot. Prova `https://IP:8443/health` dal visore: deve rispondere `{"ok":true}`. |
| Non compare "Entra in VR/AR" | Stai usando `http://` invece di `https://`, oppure non hai accettato il certificato. |
| La TV dice "Server non raggiungibile" | Il server è chiuso: rilancia `npm start`. Le partite sono salvate in `data/games.json` e non si perdono. |
| L'HoloLens va a scatti | Chiudi le altre app aperte sull'HoloLens; tienilo lontano da fonti di calore. |
| L'HoloLens non entra in AR | Si può giocare anche nella finestra 2D di Edge: mira con il raggio della mano e fai tap. |
| Il Quest si spegne | Impostazioni → Alimentazione: aumenta il tempo di spegnimento automatico prima della fiera. |
| Hotspot instabile | Il gioco continua a funzionare offline sul visore; si ricollega da solo. Le partite giocate senza connessione non vanno in classifica. |

## Prima di partire (giovedì sera)

- [ ] `git pull` / ultima versione sul portatile, `npm install`, `npm run check`
- [ ] Prova completa a casa con l'hotspot del telefono che userete in fiera
- [ ] Accetta il certificato su tutti i visori con l'IP dell'hotspot
- [ ] Svuota le partite di prova: cancella `data/games.json` (o eliminale dal pannello)
- [ ] Carica tutto
