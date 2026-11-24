import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ServerConfig {
  title: string;
  school: string;
  course: string;
  /** Link mostrato come QR sulla TV (sito della scuola, pagina dell'indirizzo...). */
  qrUrl: string;
  qrLabel: string;
  httpPort: number;
  httpsPort: number;
  /** PIN per il pannello operatore. Vuoto = nessun PIN. */
  adminPin: string;
  dataDir: string;
}

const DEFAULTS: ServerConfig = {
  title: "Orbita",
  school: "ITI G. Marconi · Dalmine",
  course: "Informatica e Telecomunicazioni",
  qrUrl: "https://www.itisdalmine.edu.it",
  qrLabel: "Scopri il Marconi",
  httpPort: 8080,
  httpsPort: 8443,
  adminPin: "",
  dataDir: "data",
};

export const ROOT = resolve(import.meta.dirname, "../..");

/** Legge `config.json` nella radice del progetto (opzionale) e le variabili d'ambiente. */
export function loadConfig(): ServerConfig {
  const file = resolve(ROOT, "config.json");
  const fromFile: Partial<ServerConfig> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const cfg: ServerConfig = { ...DEFAULTS, ...fromFile };
  if (process.env.HTTP_PORT) cfg.httpPort = Number(process.env.HTTP_PORT);
  if (process.env.HTTPS_PORT) cfg.httpsPort = Number(process.env.HTTPS_PORT);
  if (process.env.ADMIN_PIN !== undefined) cfg.adminPin = process.env.ADMIN_PIN;
  cfg.dataDir = resolve(ROOT, cfg.dataDir);
  return cfg;
}
