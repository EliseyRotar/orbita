const nf = new Intl.NumberFormat("it-IT");

export const fmt = (n: number) => nf.format(Math.round(n));

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function minutes(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
