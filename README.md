# Orbita

Space shooter arcade in 3D che gira **nel browser** su PC, telefono, **Meta Quest 2 (VR)** e **HoloLens 2 (AR)**.
Tutte le postazioni sono collegate a un server sul portatile:

- un **monitor classifica** mostra la tabella HIGH SCORES del giorno, chi sta giocando, i numeri della giornata
  e la sfida tra dispositivi;
- un **monitor spettatore** ricostruisce in 3D, dal vivo, la partita di chi sta facendo più punti;
- un **pannello operatore** permette di assegnare il nome al prossimo ragazzo in fila senza fargli scrivere
  niente sul visore.

Progetto della 5BI (Informatica) dell'ITI G. Marconi di Dalmine per la
[Fiera dell'Orientamento 2026](http://fieraorientamento.provincia.bergamo.it/) — Fiera di Bergamo, padiglione A,
venerdì 27 (9–14) e sabato 28 novembre (9–18).

È l'evoluzione del nostro Space Shooter in Pygame dell'anno scorso (`../python-space-shooter-main.zip`):
stessa idea (asteroidi che si dividono, combo, power-up, boss, 3 vite) rifatta da zero in 3D per VR e AR.

## Come si gioca

| Dispositivo | Mira | Spara |
| --- | --- | --- |
| PC | mouse | click o barra spaziatrice (tieni premuto per il fuoco automatico) |
| Telefono / tablet | dito | tap |
| Meta Quest 2 | pistola laser in mano (controller) | grilletto |
| HoloLens 2 | raggio della mano | gesto di pizzico (air tap) |

- I meteoriti grandi si dividono in medi, i medi in piccoli.
- I **cristalli verdi** danno un potenziamento: colpo triplo, tempo lento, scudo, vita extra, punti doppi.
- Dalla seconda ondata arrivano le **navicelle nemiche**: sparano plasma rosa, che si può abbattere al volo.
- Ogni 4 ondate arriva il **boss**, che lancia mine.
- Distruggerne tanti di fila fa salire la **combo** fino a x5. Si gioca fino a esaurire le 3 vite.

## Online

**https://orbita-arcade.pages.dev** — gioco (anche dal telefono), `/monitor`, `/spettatore`, `/admin` (con PIN).

- Le pagine sono su **Cloudflare Pages**; la classifica e il tempo reale stanno in un **Durable Object**
  del Worker `orbita` (SQLite), raggiunto da Pages tramite `pages/functions/ws.ts`. Tutto nel piano gratuito.
- Pubblicare una nuova versione: `npm run deploy` (serve `npx wrangler login` la prima volta).
- PIN del pannello operatore: `npx wrangler secret put ADMIN_PIN` dentro la cartella del progetto.

## Piano B in locale (senza internet)

Serve [Node.js](https://nodejs.org) 20.10 o più recente.

```bash
npm install
npm run fiera      # compila il client e avvia il server
```

Il server stampa gli indirizzi:

| Pagina | Indirizzo |
| --- | --- |
| Monitor classifica | `http://localhost:8080/monitor` |
| Monitor spettatore | `http://localhost:8080/spettatore` |
| Pannello operatore | `http://localhost:8080/admin` |
| Gioco (visori e altri PC) | `https://<ip-del-pc>:8443/` |

In locale WebXR richiede comunque HTTPS: il server crea da solo un certificato autofirmato per gli IP della rete.
Al primo accesso da ogni dispositivo il browser mostra un avviso: **Avanzate → Continua**.

- Come montare lo stand: [docs/FIERA.md](docs/FIERA.md)
- Materiale da portare e richiesta all'ufficio tecnico: [docs/MATERIALE.md](docs/MATERIALE.md)
- Cosa resta da fare: [TODO.md](TODO.md)

## Sviluppo

```bash
npm run dev        # server con Vite in modalità sviluppo (niente build)
npm run check      # typecheck + test + build
```

Per provare VR e AR senza visore apri `http://localhost:8080/?emulate&debug`: si attiva l'emulatore WebXR
di Meta ([IWER](https://github.com/meta-quest/immersive-web-emulation-runtime)) che simula un Quest 3.
Con `?debug` lo stato del gioco è accessibile da console in `window.orbita`.

### Struttura

```
src/
  shared/protocol.ts     messaggi WebSocket condivisi (postazioni, monitor, spettatore, operatore)
  worker/                Cloudflare: Worker + Durable Object "Fair" con classifica in SQLite
  server/
    hub.ts, records.ts   logica condivisa tra Cloudflare e server locale
    index.ts             server locale: HTTP (monitor, operatore) + HTTPS (visori) + WebSocket
    hub.ts               stato della fiera: postazioni, partite live, coda, feed, inoltro allo spettatore
    store.ts             archivio partite su file JSON (scrittura atomica)
    certs.ts             certificato HTTPS autofirmato per gli IP della LAN
  client/
    common/              rete con riconnessione, caricamento modelli 3D, token grafici
    play/                il gioco (three.js + WebXR)
      game/Game.ts       logica comune a PC, VR e AR, fotogrammi per lo spettatore
      game/rules.ts      regole e bilanciamento (testate)
      game/panel.ts      HUD e schermate pixel-art dentro la scena 3D dei visori
      game/audio.ts      effetti e musica
    tv/                  monitor classifica
    spectator/           monitor spettatore 3D
    admin/               pannello operatore
public/media/            modelli, suoni, musica, cielo (vedi CREDITS.md)
tests/                   test (Vitest)
```

Le partite vengono salvate in `data/games.json`. Per cambiare testi, link del QR, porte o mettere un PIN al
pannello operatore, copia `config.example.json` in `config.json`.

## Grafica

Stile "Cabinato": sala giochi anni '80, nero pieno, giallo/rosa/ciano/verde, font Press Start 2P e VT323.
Le direzioni grafiche e le schermate sono state progettate su Claude Design prima di scrivere il codice.
Il mondo 3D usa i modelli low-poly del Kenney Space Kit e la vera mappa della Via Lattea della NASA.

## Crediti e licenza

Asset di terzi (tutti CC0, pubblico dominio o OFL): vedi [CREDITS.md](CREDITS.md).
Codice: MIT, classe 5BI, ITI G. Marconi — Dalmine.
