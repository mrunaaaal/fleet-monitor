// Written once, consumed by both a future registry view and the agent's
// list_services tool (fleet-monitor-docs.md §6) — names and tiers, one row
// each.
export function createListServicesQuery({ postgres }) {
  return async function listServices() {
    const rows = await postgres.query('SELECT name, tier FROM services ORDER BY name');
    return rows.map((row) => ({ name: row.name, tier: row.tier }));
  };
}
