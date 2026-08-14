import { useCallback, useRef, useState } from 'react';
import { investigate } from '../api/client.js';

const CATEGORY_LABELS = {
  latency: 'Latency',
  error: 'Errors',
  unavailable: 'Unavailable',
  resource: 'Resource',
  unknown: 'Unknown',
};

// Investigate page (spec issue #15, fleet-monitor-docs.md §7.4/§10): a
// symptom box that opens the SSE stream from POST /v1/investigate,
// appends the live tool-call trace as it arrives, and renders the
// structured finding once submit_findings terminates the loop.
export default function Investigate() {
  const [symptom, setSymptom] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [trace, setTrace] = useState([]);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const abortRef = useRef(null);

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (!symptom.trim() || status === 'running') return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus('running');
      setTrace([]);
      setResult(null);
      setErrorMessage(null);

      investigate(
        { symptom: symptom.trim() },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'tool_call') {
              setTrace((prev) => [...prev, event]);
            } else if (event.type === 'result') {
              setResult(event);
              setStatus('done');
            } else if (event.type === 'error') {
              setErrorMessage(event.message);
              setStatus('error');
            }
            // 'terminated' (server/agent/loop.js) always precedes 'result',
            // which carries the same terminated value plus the findings —
            // nothing to render here that 'result' doesn't already cover.
          },
        },
      ).catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorMessage(err.message);
        setStatus('error');
      });
    },
    [symptom, status],
  );

  return (
    <section className="investigate-page">
      <form className="investigate-form" onSubmit={handleSubmit}>
        <label htmlFor="symptom">Symptom</label>
        <textarea
          id="symptom"
          value={symptom}
          onChange={(e) => setSymptom(e.target.value)}
          placeholder="e.g. checkout is timing out for users"
          rows={3}
          disabled={status === 'running'}
        />
        <button type="submit" disabled={status === 'running' || !symptom.trim()}>
          {status === 'running' ? 'Investigating…' : 'Investigate'}
        </button>
      </form>

      {errorMessage && <p className="overview-error">{errorMessage}</p>}

      {trace.length > 0 && (
        <ol className="investigate-trace">
          {trace.map((event, i) => (
            <li key={i}>
              <ToolCallEntry event={event} />
            </li>
          ))}
        </ol>
      )}

      {status === 'running' && trace.length === 0 && <p className="overview-empty">Starting investigation…</p>}

      {result && <FindingCard result={result} />}
    </section>
  );
}

function ToolCallEntry({ event }) {
  const { name, input, out } = event;
  const hasError = out && typeof out === 'object' && 'error' in out;

  return (
    <div className={`trace-entry trace-entry-${hasError ? 'error' : name.replace(/_/g, '-')}`}>
      <div className="trace-entry-header">
        <span className="trace-entry-name">{name}</span>
        {/* submit_findings' input is the full findings object, already rendered by FindingCard below */}
        {name !== 'submit_findings' && Object.keys(input ?? {}).length > 0 && (
          <span className="trace-entry-input">{formatInput(input)}</span>
        )}
      </div>
      <div className="trace-entry-body">
        {hasError ? <p className="overview-error">{out.error}</p> : <ToolResult name={name} out={out} />}
      </div>
    </div>
  );
}

function formatInput(input) {
  return Object.entries(input)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join(' · ');
}

// Each tool's output shape is different (server/agent/tools.js,
// summarizing-tools.js, submit-findings-tool.js) — rendered distinctly
// rather than through one generic JSON dump, per fleet-monitor-docs.md
// §10's "rendering each tool result type differently".
function ToolResult({ name, out }) {
  switch (name) {
    case 'list_services':
      return (
        <ul className="trace-service-list">
          {out.services.map((s) => (
            <li key={s.name}>
              <span className={`tier tier-${s.tier}`}>{s.tier}</span> {s.name}
            </li>
          ))}
        </ul>
      );

    case 'check_liveness':
      return (
        <ul className="trace-liveness-list">
          {out.liveness.map((row) => (
            <li key={row.service}>
              <span className={`liveness-dot liveness-${row.up ? 'up' : 'down'}`} />
              {row.service}
            </li>
          ))}
        </ul>
      );

    case 'get_dependencies':
      return out.downstream.length === 0 ? (
        <p>{out.service} has no downstream dependencies.</p>
      ) : (
        <p>
          {out.service} → {out.downstream.map((d) => d.service).join(', ')}
        </p>
      );

    case 'find_shared_dependency':
      return out.shared_dependencies.length === 0 ? (
        <p>No shared dependency found across {out.services.join(', ')}.</p>
      ) : (
        <p>Shared: {out.shared_dependencies.map((d) => `${d.service} (covers ${d.covers})`).join(', ')}</p>
      );

    case 'get_blast_radius':
      return out.affected.length === 0 ? (
        <p>Nothing depends on {out.service}.</p>
      ) : (
        <ul className="blast-radius-list">
          {out.affected.map((row) => (
            <li key={row.service}>
              <span className={`tier tier-${row.tier}`}>{row.tier}</span>
              <span className="blast-radius-service">{row.service}</span>
              <span className="blast-radius-hops">
                {row.hops} hop{row.hops === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      );

    case 'query_metrics':
      return (
        <dl className="trace-metrics">
          <dt>trend</dt>
          <dd>{out.trend}</dd>
          <dt>mean</dt>
          <dd>{formatNumber(out.mean)}</dd>
          <dt>p95</dt>
          <dd>{formatNumber(out.p95)}</dd>
          <dt>min / max</dt>
          <dd>
            {formatNumber(out.min)} / {formatNumber(out.max)}
          </dd>
        </dl>
      );

    case 'search_logs':
      return (
        <div>
          <p>
            {out.total} log line{out.total === 1 ? '' : 's'}
            {out.time_range ? ` between ${new Date(out.time_range.first).toLocaleTimeString()} and ${new Date(out.time_range.last).toLocaleTimeString()}` : ''}
          </p>
          {out.patterns.length > 0 && (
            <ul className="trace-log-patterns">
              {out.patterns.map((p, i) => (
                <li key={i}>
                  <span className="trace-log-count">{p.count}×</span> {p.template}
                </li>
              ))}
            </ul>
          )}
        </div>
      );

    case 'get_log_samples':
      return (
        <ul className="trace-log-samples">
          {out.samples.map((s, i) => (
            <li key={i}>
              <span className={`log-level log-level-${s.level}`}>{s.level}</span>
              <code>{s.message}</code>
            </li>
          ))}
        </ul>
      );

    case 'submit_findings':
      return <p>Findings submitted — see the report below.</p>;

    default:
      return <pre className="trace-raw">{JSON.stringify(out, null, 2)}</pre>;
  }
}

function formatNumber(value) {
  return value == null ? '–' : Math.round(value * 10) / 10;
}

function FindingCard({ result }) {
  const { findings, terminated } = result;

  if (!findings) {
    return (
      <article className="finding-card finding-card-inconclusive">
        <h3>Investigation inconclusive</h3>
        <p>Terminated: {terminated ?? 'unknown'}</p>
      </article>
    );
  }

  return (
    <article className="finding-card">
      <h3>Findings</h3>
      <p className="finding-summary">{findings.summary}</p>

      {findings.root_cause_services.length > 0 && (
        <div className="finding-section">
          <h4>Root cause</h4>
          <ul className="finding-root-causes">
            {findings.root_cause_services.map((cause) => (
              <li key={cause.service}>
                <span className="finding-service">{cause.service}</span>
                <span className={`finding-category finding-category-${cause.category}`}>
                  {CATEGORY_LABELS[cause.category] ?? cause.category}
                </span>
                <span className={`finding-confidence finding-confidence-${cause.confidence}`}>{cause.confidence} confidence</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {findings.evidence.length > 0 && (
        <div className="finding-section">
          <h4>Evidence</h4>
          <ul className="finding-evidence">
            {findings.evidence.map((e, i) => (
              <li key={i}>
                <span className="finding-evidence-source">{e.source}</span> {e.observation}
              </li>
            ))}
          </ul>
        </div>
      )}

      {findings.affected_services.length > 0 && (
        <div className="finding-section">
          <h4>Blast radius</h4>
          <p>{findings.affected_services.join(', ')}</p>
        </div>
      )}

      <div className="finding-section">
        <h4>Suggested remediation</h4>
        <p>{findings.suggested_remediation}</p>
      </div>
    </article>
  );
}
