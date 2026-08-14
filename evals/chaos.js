// Chaos control for the eval runner (spec issue #17, fleet-monitor-docs.md
// §8.3): every mesh service exposes POST /chaos directly (§3.3) — there is
// no server-side helper, so the runner talks to the mesh the same way the
// docker-compose.yml comment does: by host port, from outside the compose
// network. fetchImpl is injected so this is testable without a live mesh.
import { services } from '../mesh/config.js';

function chaosUrl(host, port) {
  return `http://${host}:${port}/chaos`;
}

export function createChaosController({ host = 'localhost', fetchImpl = fetch } = {}) {
  async function setMode(serviceName, mode) {
    const service = services.find((s) => s.name === serviceName);
    if (!service) throw new Error(`unknown service: ${serviceName}`);

    const res = await fetchImpl(chaosUrl(host, service.port), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      throw new Error(`chaos POST to ${serviceName} (mode: ${mode}) failed with status ${res.status}`);
    }
  }

  async function reset() {
    await Promise.all(services.map((service) => setMode(service.name, 'ok')));
  }

  async function apply(chaosSteps) {
    await Promise.all(chaosSteps.map((step) => setMode(step.service, step.mode)));
  }

  return { setMode, reset, apply };
}
