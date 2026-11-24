/** WebSocket della fiera: inoltrato all'unico Durable Object "Fair" del Worker "orbita". */
interface Env {
  FAIR: DurableObjectNamespace;
}

export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  env.FAIR.get(env.FAIR.idFromName("fiera-2026")).fetch(request);
