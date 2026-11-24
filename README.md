# Orbita

Space shooter in 3D che gira **nel browser** su PC, telefono, **Meta Quest 2 (VR)** e **HoloLens 2 (AR)**.
Tutte le postazioni sono collegate a un server sul portatile: una **TV** mostra in diretta chi sta giocando,
la classifica, le statistiche della giornata e i record. Un **pannello operatore** permette di assegnare il
nome al prossimo ragazzo in fila senza fargli scrivere niente sul visore.

Progetto della 5BI (Informatica) dell'ITI G. Marconi di Dalmine per la
[Fiera dell'Orientamento 2026](http://fieraorientamento.provincia.bergamo.it/) — Fiera di Bergamo, padiglione A,
venerdì 27 (9–14) e sabato 28 novembre (9–18).

È l'evoluzione del nostro Space Shooter in Pygame dell'anno scorso (`../python-space-shooter-main.zip`):
stessa idea (asteroidi che si dividono, combo, power-up, boss, 3 vite) rifatta da zero per funzionare in VR e AR.

## Come si gioca

Gli asteroidi arrivano verso la stazione da davanti. Si mira e si spara:

| Dispositivo | Mira | Spara |
| --- | --- | --- |
| PC | mouse | click o barra spaziatrice (tieni premuto per il fuoco automatico) |
| Telefono / tablet | dito | tap |
| Meta Quest 2 | raggio del controller | grilletto |
| HoloLens 2 | raggio della mano | gesto di pizzico (air tap) |

- Gli asteroidi grandi si dividono in medi, i medi in piccoli.
- Gli **asteroidi dorati** danno un potenziamento: colpo triplo, tempo lento, scudo, vita extra, punti doppi.
- Distruggerne tanti di fila fa salire la **combo** fino a x5.
- Ogni 4 ondate arriva un **boss** che lancia mine: colpisci il nucleo.
- Si gioca fino a esaurire le 3 vite.

## Avvio rapido

Serve [Node.js](https://nodejs.org) 20.10 o più recente.

```bash
npm install
npm run fiera      # compila il client e avvia il server
```

Il server stampa gli indirizzi:

- `http://localhost:8080/tv` → da aprire a schermo intero sulla TV (F11)
- `http://localhost:8080/admin` → pannello operatore
- `https://<ip-del-pc>:8443/` → da aprire su Quest, HoloLens e altri PC

WebXR funziona solo in HTTPS, per questo il server crea da solo un certificato autofirmato.
Al primo accesso da ogni visore il browser mostra un avviso: **Avanzate → Continua**.

La guida passo passo per montare lo stand è in [docs/FIERA.md](docs/FIERA.md).

## Sviluppo

```bash
npm run dev        # server con Vite in modalità sviluppo (niente build)
npm run check      # typecheck + test + build
```

Per provare la VR/AR senza visore: apri `http://localhost:8080/?emulate&debug`. Si attiva l'emulatore
WebXR di Meta ([IWER](https://github.com/meta-quest/immersive-web-emulation-runtime)) che simula un Quest 3;
con `?debug` gli oggetti di gioco sono accessibili da console in `window.orbita`.

### Struttura

```
src/
  shared/protocol.ts     messaggi WebSocket condivisi tra server e client
  server/
    index.ts             server HTTP (TV, operatore) + HTTPS (visori) + WebSocket
    hub.ts               stato della fiera: postazioni, partite live, coda, feed eventi
    store.ts             archivio partite su file JSON (scrittura atomica)
    certs.ts             certificato HTTPS autofirmato per gli IP della LAN
    config.ts            configurazione (config.json opzionale)
  client/
    play/                il gioco (three.js + WebXR)
      game/Game.ts       logica comune a tutte le modalità
      game/rules.ts      regole e bilanciamento (testate)
      game/panel.ts      HUD e schermate disegnate dentro la scena 3D per i visori
    tv/                  dashboard per la TV
    admin/               pannello operatore
tests/                   test (Vitest)
```

### Configurazione

Copia `config.example.json` in `config.json` per cambiare testi, link del QR sulla TV, porte o mettere un
PIN al pannello operatore. Le partite vengono salvate in `data/games.json`.

## Tecnologie

TypeScript, [three.js](https://threejs.org) e WebXR per il gioco, Node.js con `ws` per il server,
Vite per la build, Vitest per i test. Font: Big Shoulders Display e Atkinson Hyperlegible (inclusi, funzionano offline).

## Autori

Classe 5BI, ITI G. Marconi — Dalmine.

## Licenza

MIT
