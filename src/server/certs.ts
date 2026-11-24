import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { generate } from "selfsigned";

/** Indirizzi IPv4 della LAN (esclude loopback e bridge di Docker). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

/**
 * WebXR funziona solo in un contesto sicuro: per Quest e HoloLens serve HTTPS.
 * Generiamo un certificato autofirmato (una volta) valido per gli IP attuali.
 * Se cambia rete e l'IP non è coperto, il certificato viene rigenerato.
 */
export async function loadOrCreateCert(dir: string): Promise<{ key: string; cert: string }> {
  mkdirSync(dir, { recursive: true });
  const keyFile = join(dir, "key.pem");
  const certFile = join(dir, "cert.pem");
  const ipsFile = join(dir, "ips.json");
  const ips = lanAddresses();

  if (existsSync(keyFile) && existsSync(certFile) && existsSync(ipsFile)) {
    const covered: string[] = JSON.parse(readFileSync(ipsFile, "utf8"));
    if (ips.every((ip) => covered.includes(ip))) {
      return { key: readFileSync(keyFile, "utf8"), cert: readFileSync(certFile, "utf8") };
    }
  }

  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  const pems = await generate([{ name: "commonName", value: "orbita.local" }], {
    keySize: 2048,
    days: 825,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  } as never);
  writeFileSync(keyFile, pems.private);
  writeFileSync(certFile, pems.cert);
  writeFileSync(ipsFile, JSON.stringify(ips));
  console.log(`[certs] nuovo certificato per: localhost, ${ips.join(", ")}`);
  return { key: pems.private, cert: pems.cert };
}
