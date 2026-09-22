// Stands in for the `cloudflare:workers` module when @flue/runtime/cloudflare
// is imported under Node (unit tests of app.ts). Flue probes `tracing` and
// falls back to a no-op tracer when it is missing; nothing else is touched.
export const tracing = undefined;

export class DurableObject {}
