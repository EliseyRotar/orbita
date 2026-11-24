# Materiale per lo stand

Lista di cosa serve per Orbita alla Fiera dell'Orientamento (Fiera di Bergamo, padiglione A,
venerdì 27 novembre 9–14 e sabato 28 novembre 9–18). In fondo c'è il messaggio da mandare
all'ufficio tecnico.

## Come è montato lo stand

```
                 ┌──────────────────┐   ┌──────────────────┐
                 │  MONITOR 1       │   │  MONITOR 2       │
                 │  classifica      │   │  spettatore      │
                 │  /monitor        │   │  /spettatore     │
                 └────────┬─────────┘   └────────┬─────────┘
                       HDMI                    HDMI
                 ┌────────┴─────────┐   ┌────────┴─────────┐
                 │ PORTATILE A      │   │ PORTATILE B      │
                 │ server + pannello│   │ gioco col mouse  │
                 │ operatore        │   │ (si gioca qui)   │
                 └────────┬─────────┘   └────────┬─────────┘
                          │        Wi-Fi         │
                 ┌────────┴──────────────────────┴─────────┐
                 │   ROUTER / ACCESS POINT (rete locale)   │
                 └──┬──────┬──────┬──────┬──────┬──────┬───┘
                   HL1    HL2    HL3    HL4    HL5   Quest 2
```

- **Portatile A** (il nostro, Arch Linux): fa da server, mostra il pannello operatore sul suo schermo
  e la classifica sul monitor 1 (schermo esteso).
- **Portatile B** (della scuola, Windows 11): ci si gioca con il mouse sul suo schermo e manda la vista
  spettatore sul monitor 2 (schermo esteso). Basta un browser: niente da installare.
- Il gioco funziona **senza internet**: serve solo che tutti siano sulla stessa rete.

## Lista

### Dalla scuola / ufficio tecnico

- [ ] 2 monitor 27" o 32", 1920×1080, con piedistallo e cavo di alimentazione
- [ ] 2 cavi HDMI lunghi almeno 2 m (+ adattatori USB-C → HDMI se i portatili non hanno l'HDMI)
- [ ] 1 portatile Windows 11 con Chrome o Edge aggiornato (portatile B)
- [ ] 1 mouse USB (meglio 2, uno di riserva)
- [ ] **1 router o access point Wi-Fi** (anche senza internet). Importante: l'hotspot dell'iPhone accetta
      pochi dispositivi alla volta e noi ne abbiamo 8 (5 HoloLens, Quest, 2 portatili)
- [ ] 2 ciabatte da almeno 6 prese + 1 prolunga
- [ ] Nastro adesivo per fissare i cavi a terra (la gente inciampa)
- [ ] Casse piccole per il portatile B (facoltative: in fiera c'è molto rumore)
- [ ] 5 HoloLens 2 e Meta Quest 2 con i loro caricatori (USB-C per gli HoloLens)

### Da portare noi

- [ ] Portatile A con Orbita già installato e provato (`npm install` fatto a casa) + caricatore
- [ ] Controller del Quest con pile cariche + pile di ricambio
- [ ] Telefono per l'hotspot di riserva + powerbank
- [ ] Salviette igienizzanti per i visori (li indossano centinaia di ragazzi)
- [ ] Etichette o nastro colorato con il numero di ogni HoloLens (1–5), da far combaciare con il pannello operatore
- [ ] Un foglio stampato con l'indirizzo del server e la guida rapida ([FIERA.md](FIERA.md))

### Da chiedere all'organizzazione della fiera

- [ ] Quante prese di corrente ci sono allo stand e quanta potenza (2 portatili, 2 monitor, ricarica di 6 visori)
- [ ] Dimensione del tavolo e se possiamo mettere i monitor in piedi dietro al tavolo
- [ ] Se c'è un Wi-Fi della fiera (noi useremo comunque la nostra rete, ma conviene saperlo per le interferenze)

## Messaggio per l'ufficio tecnico

> Buongiorno,
> per la Fiera dell'Orientamento di venerdì 27 e sabato 28 novembre la 5BI porta allo stand del Marconi
> un gioco in realtà virtuale e aumentata (HoloLens e Quest) con classifica in diretta.
> Ci servirebbe, se possibile:
>
> - 2 monitor 27"/32" Full HD con cavi HDMI da almeno 2 m (e adattatori USB-C → HDMI)
> - 1 portatile Windows 11 con Chrome/Edge e 1–2 mouse
> - 1 router o access point Wi-Fi (non serve internet: è per collegare 8 dispositivi in rete locale)
> - 2 ciabatte da 6 prese e una prolunga
> - i 5 HoloLens 2 e il Meta Quest 2 con i caricatori
>
> Possiamo passare a ritirare il materiale giovedì 26 per una prova completa.
> Grazie, [nome e cognome], 5BI
