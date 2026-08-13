// Topology for the demo mesh (fleet-monitor-docs.md §3.1).
//
//   web ──────────┐
//                 ├──▶ api-gateway ──┬──▶ auth-service ──▶ session-store
//   checkout ─────┘                  ├──▶ payments ──────▶ ledger-db
//                                    └──▶ inventory ─────▶ ledger-db
//
// Depth 4 (web -> api-gateway -> auth-service -> session-store) and a
// diamond (payments/inventory both depend on ledger-db) fall straight out
// of the graph shape above.
//
// Asymmetric impact doesn't: with one shared api-gateway node, breaking
// auth-service would otherwise affect every caller equally. api-gateway's
// `routesByFeature` restricts which of its downstream targets each
// incoming feature actually needs — web's flow touches auth-service
// (session check), checkout's doesn't — so breaking auth-service takes
// down web while checkout keeps working.

export const services = [
  {
    name: 'web',
    tier: 'user-facing',
    port: 4001,
    downstream: [{ name: 'api-gateway', query: { feature: 'web' } }],
  },
  {
    name: 'checkout',
    tier: 'user-facing',
    port: 4002,
    downstream: [{ name: 'api-gateway', query: { feature: 'checkout' } }],
  },
  {
    name: 'api-gateway',
    tier: 'internal',
    port: 4003,
    downstream: ['auth-service', 'payments', 'inventory'],
    routesByFeature: {
      web: ['auth-service', 'payments', 'inventory'],
      checkout: ['payments', 'inventory'],
    },
  },
  { name: 'auth-service', tier: 'internal', port: 4004, downstream: ['session-store'] },
  { name: 'payments', tier: 'internal', port: 4005, downstream: ['ledger-db'] },
  { name: 'inventory', tier: 'internal', port: 4006, downstream: ['ledger-db'] },
  { name: 'session-store', tier: 'datastore', port: 4007, downstream: [] },
  { name: 'ledger-db', tier: 'datastore', port: 4008, downstream: [] },
];

export const TIERS = ['user-facing', 'internal', 'datastore'];

export const userFacingServices = services.filter((s) => s.tier === 'user-facing');

export function getServiceConfig(name) {
  return services.find((s) => s.name === name);
}

// A downstream entry is either a bare service name or `{ name, query }`
// when the caller needs to pass a query string (e.g. `?feature=web`).
export function downstreamName(entry) {
  return typeof entry === 'string' ? entry : entry.name;
}

export function downstreamQuery(entry) {
  return typeof entry === 'string' ? undefined : entry.query;
}

// In docker compose, mesh services are reachable by their compose service
// name on the internal network, always on port 3000.
export function resolveServiceUrl(name) {
  return `http://${name}:3000`;
}
