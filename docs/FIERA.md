# Guida allo stand

Come montare Orbita alla Fiera dell'Orientamento e cosa fare se qualcosa non va.
Il materiale da portare e il messaggio per l'ufficio tecnico sono in [MATERIALE.md](MATERIALE.md).

## Turni

| Giorno | Orario | Chi c'è |
| --- | --- | --- |
| Venerdì 27 novembre | 9:00 – 14:00 | ELI6, Federico Poli |
| Sabato 28 novembre | 9:00 – 18:00 | ELI6, Andrea Moretti, Ouertani Mabrouk, (Viola Zanchi) |

I visitatori sono soprattutto ragazzi di terza media con i genitori: spiegazioni brevi, partite veloci.
Quando chiedono "cosa si fa al Marconi?" si indica il QR sul monitor della classifica.

## Ruoli allo stand

- **Operatore** (al portatile A): scrive i nomi, gestisce la coda, tiene d'occhio il pannello.
- **Assistente visori** (1–2 persone): mette e toglie gli HoloLens e il Quest, spiega in 10 secondi come si spara.
- **Chi accoglie**: invita chi passa, indica il monitor spettatore e la classifica, risponde sulla scuola.

## Indirizzi

Tutto è online, non serve un server sul portatile:

| Cosa | Indirizzo |
| --- | --- |
| Gioco (visori, PC, telefoni) | https://orbita-arcade.pages.dev |
| Monitor classifica | https://orbita-arcade.pages.dev/monitor |
| Monitor spettatore | https://orbita-arcade.pages.dev/spettatore |
| Pannello operatore (PIN) | https://orbita-arcade.pages.dev/admin |

Ogni dispositivo deve solo avere internet (i vostri due hotspot). I visitatori giocano dal telefono con il QR del monitor.
Se internet in fiera non va, c'è il piano B locale descritto sotto.

## Piano B: montaggio in locale (circa 20 minuti)

1. **Rete**: accendi il router (o l'hotspot). Collega i due portatili, il Quest e i 5 HoloLens alla stessa rete.
2. **Server** sul portatile A, nella cartella `orbita`:
   ```bash
   npm start
   ```
   Annota l'indirizzo `https://…:8443/` che stampa (è anche nel pannello operatore, in fondo).
3. **Monitor 1 (classifica)**: dal portatile A apri `http://localhost:8080/monitor`, trascina la finestra sul
   monitor esterno e premi F11.
4. **Operatore**: sul portatile A apri `http://localhost:8080/admin`.
5. **Monitor 2 (spettatore)**: sul portatile B apri `https://IP-DEL-PORTATILE-A:8443/spettatore`
   (accetta il certificato), trascinala sul monitor esterno, F11.
6. **Gioco col mouse**: sul portatile B, in un'altra finestra, apri `https://IP-DEL-PORTATILE-A:8443/`.
7. **HoloLens** (uno alla volta): Edge → indirizzo `https://…:8443/` → Avanzate → Continua →
   **ENTRA IN AR**. Rimangono in AR tra una partita e l'altra.
8. **Quest 2**: browser del Quest → stesso indirizzo → accetta il certificato → **ENTRA IN VR**.
9. Nel pannello operatore rinomina le postazioni ("HoloLens 1" … "HoloLens 5", "Quest", "PC") come
   le etichette attaccate ai visori.
10. Una partita di prova per ogni visore: deve comparire sul monitor classifica e sullo spettatore.

Se l'IP del portatile A cambia (rete diversa), riavvia il server: crea un nuovo certificato e sui visori
va riaccettato.

## Durante la fiera

1. Un ragazzo arriva: scrivi il nome nella postazione libera del pannello e premi Invio.
   Se c'è fila, aggiungi i nomi nella **Coda** e usa "Primo in coda" quando un visore si libera.
2. Mettigli il visore: vede "TOCCA A …". Preme il grilletto (Quest) o fa il pizzico (HoloLens) e parte.
3. A fine partita vede punteggio e posizione. Dopo 3 secondi il visore è pronto per il prossimo.
4. Il monitor spettatore segue da solo la partita con più punti. Toccando un riquadro in basso si sceglie
   una postazione precisa; toccandolo di nuovo si torna in automatico.
5. Qualcuno deve andare via a metà: **Termina partita** dal pannello (il punteggio viene salvato).
6. Nome inadatto in classifica: **Rinomina** o **Elimina** in "Ultime partite".
7. Annunci (es. un incontro in sala): "Messaggio sul monitor".

## Problemi comuni

| Problema | Cosa fare |
| --- | --- |
| Un visore non trova il server | Controlla che sia sulla stessa rete. Apri `https://IP:8443/health` dal visore: deve rispondere `{"ok":true}`. |
| Non compare "ENTRA IN VR/AR" | Stai usando `http://` invece di `https://`, oppure non hai accettato il certificato. |
| I monitor dicono "SERVER NON RAGGIUNGIBILE" | Il server è chiuso: rilancia `npm start`. Le partite sono salvate in `data/games.json`. |
| Lo spettatore è fermo su "IN ATTESA" | Nessuno sta giocando, oppure il visore che gioca ha perso la rete. |
| Un HoloLens va a scatti | Chiudi le altre app sull'HoloLens; tienilo lontano dal calore; riavvialo nella pausa. |
| L'HoloLens non entra in AR | Si può giocare nella finestra 2D di Edge: mira con il raggio della mano e fai tap. |
| Il Quest si spegne da solo | Impostazioni → Alimentazione: aumenta il tempo prima dello spegnimento automatico. |
| Troppi dispositivi sull'hotspot | L'hotspot dell'iPhone accetta pochi dispositivi: usa il router dell'ufficio tecnico. |
| Niente audio sul PC | Clicca una volta sulla pagina (i browser bloccano l'audio finché non si interagisce), poi controlla "audio: si" in basso. |

## Prima di partire (giovedì 26)

- [ ] Ultima versione sul portatile A, `npm install`, `npm run check`
- [ ] Prova completa con la rete che userete in fiera (router o hotspot)
- [ ] Accetta il certificato su tutti i visori e sul portatile B
- [ ] Svuota le partite di prova: cancella `data/games.json` (o eliminale dal pannello)
- [ ] Carica tutto: HoloLens, Quest e controller, portatili, powerbank
