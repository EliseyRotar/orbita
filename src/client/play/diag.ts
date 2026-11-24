/**
 * Pannello "diagnosi visore": verifica cosa supporta il browser e prova ad aprire
 * una sessione WebXR minima (come gli esempi ufficiali), riportando il risultato.
 * Serve allo stand per capire in 10 secondi se un visore è pronto.
 */

type Line = { label: string; value: string; ok: boolean | null };

function edgeVersion(): string {
  const ua = navigator.userAgent;
  return ua.match(/Edg\/[\d.]+/)?.[0] ?? ua.match(/OculusBrowser\/[\d.]+/)?.[0] ?? ua.match(/Chrome\/[\d.]+/)?.[0] ?? "sconosciuto";
}

async function supported(mode: XRSessionMode): Promise<boolean | null> {
  if (!navigator.xr) return null;
  return navigator.xr.isSessionSupported(mode).catch(() => false);
}

/** Prova a entrare e uscire subito da una sessione, con timeout. */
async function tryMode(mode: XRSessionMode): Promise<string> {
  if (!navigator.xr) return "WebXR non disponibile";
  const t0 = performance.now();
  try {
    const session = await Promise.race([
      navigator.xr.requestSession(mode),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("nessuna risposta in 12 s")), 12000)),
    ]);
    const ms = Math.round(performance.now() - t0);
    await session.end().catch(() => {});
    return `OK in ${ms} ms`;
  } catch (err) {
    const e = err as Error;
    return `ERRORE ${e.name ?? ""}: ${e.message ?? err}`;
  }
}

export function setupDiagnostics(button: HTMLButtonElement, panel: HTMLElement): void {
  const render = (lines: Line[]) => {
    panel.querySelector(".diag-lines")!.innerHTML = lines
      .map((l) => `<li data-ok="${l.ok}"><span>${l.label}</span><b>${l.value.replace(/[<>&]/g, "")}</b></li>`)
      .join("");
  };

  const lines: Line[] = [];
  const refresh = async () => {
    lines.length = 0;
    lines.push({ label: "Browser", value: edgeVersion(), ok: null });
    lines.push({ label: "Connessione sicura (HTTPS)", value: window.isSecureContext ? "sì" : "no", ok: window.isSecureContext });
    lines.push({ label: "WebXR", value: navigator.xr ? "presente" : "assente", ok: !!navigator.xr });
    const [ar, vr] = await Promise.all([supported("immersive-ar"), supported("immersive-vr")]);
    lines.push({ label: "Supporta AR", value: String(ar), ok: ar });
    lines.push({ label: "Supporta VR", value: String(vr), ok: vr });
    render(lines);
  };

  button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) void refresh();
  });
  panel.querySelector(".diag-close")!.addEventListener("click", () => (panel.hidden = true));
  for (const mode of ["immersive-ar", "immersive-vr"] as const) {
    panel.querySelector(`[data-test="${mode}"]`)!.addEventListener("click", async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      const label = mode === "immersive-ar" ? "Test AR minimo" : "Test VR minimo";
      lines.push({ label, value: "in corso...", ok: null });
      render(lines);
      const res = await tryMode(mode);
      lines[lines.length - 1] = { label, value: res, ok: res.startsWith("OK") };
      render(lines);
      b.disabled = false;
    });
  }
}
