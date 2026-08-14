import { useCallback, useEffect, useState } from 'react';
import { fetchServices, fetchMetrics } from '../api/client.js';
import MetricChart from '../components/MetricChart.jsx';
import { FIELDS, POLL_INTERVAL_MS } from '../constants.js';

export default function Overview() {
  const [services, setServices] = useState([]);
  const [field, setField] = useState(FIELDS[0].value);
  const [metricsByService, setMetricsByService] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchServices()
      .then((rows) => {
        if (!cancelled) setServices(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pollMetrics = useCallback(async () => {
    if (services.length === 0) return;
    try {
      const results = await Promise.all(
        services.map((s) => fetchMetrics({ service: s.name, field }).then((rows) => [s.name, rows])),
      );
      setMetricsByService(Object.fromEntries(results));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [services, field]);

  useEffect(() => {
    pollMetrics();
    const id = setInterval(pollMetrics, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollMetrics]);

  const fieldMeta = FIELDS.find((f) => f.value === field);

  return (
    <section>
      <div className="overview-toolbar">
        <label>
          Metric:{' '}
          <select value={field} onChange={(e) => setField(e.target.value)}>
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {error && <span className="overview-error">{error}</span>}
      </div>

      {services.length === 0 && !error && <p className="overview-empty">No services registered yet.</p>}

      <div className="overview-grid">
        {services.map((service) => (
          <ServiceCard
            key={service.name}
            service={service}
            rows={metricsByService[service.name] ?? []}
            fieldMeta={fieldMeta}
          />
        ))}
      </div>
    </section>
  );
}

function ServiceCard({ service, rows, fieldMeta }) {
  const latest = rows.at(-1);
  return (
    <article className="service-card">
      <header>
        <h3>{service.name}</h3>
        <span className={`tier tier-${service.tier}`}>{service.tier}</span>
      </header>
      <MetricChart rows={rows} unit={fieldMeta?.unit} />
      <footer>{latest ? `${fieldMeta?.label}: ${formatValue(latest.mean, fieldMeta)}` : 'waiting for data…'}</footer>
    </article>
  );
}

function formatValue(value, fieldMeta) {
  if (value == null || !fieldMeta) return '–';
  const scaled = value * (fieldMeta.scale ?? 1);
  const rounded = Math.round(scaled * 10) / 10;
  return fieldMeta.unit ? `${rounded}${fieldMeta.unit}` : `${rounded}`;
}
