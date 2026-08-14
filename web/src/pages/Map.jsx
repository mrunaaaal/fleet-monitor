import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fetchTopology, fetchLiveness, fetchBlastRadius } from '../api/client.js';
import { POLL_INTERVAL_MS } from '../constants.js';

// Canvas fill styles can't read CSS custom properties directly (unlike DOM
// styles), so resolve --up/--down/--accent/--border once against the root
// element and reuse the plain color strings for node/link painting.
function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    up: styles.getPropertyValue('--up').trim() || '#16a34a',
    down: styles.getPropertyValue('--down').trim() || '#dc2626',
    unknown: styles.getPropertyValue('--border').trim() || '#9ca3af',
    accent: styles.getPropertyValue('--accent').trim() || '#7c3aed',
  };
}

export default function Map() {
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [liveness, setLiveness] = useState({});
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [blastRadius, setBlastRadius] = useState(null);
  const [blastRadiusError, setBlastRadiusError] = useState(null);
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const colors = useMemo(readThemeColors, []);

  useEffect(() => {
    let cancelled = false;
    fetchTopology()
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pollLiveness = useCallback(async () => {
    try {
      const rows = await fetchLiveness();
      setLiveness(Object.fromEntries(rows.map((row) => [row.service, row.up])));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    pollLiveness();
    const id = setInterval(pollLiveness, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollLiveness]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ id: n.service, tier: n.tier })),
      links: graph.edges.map((e) => ({ source: e.from, target: e.to })),
    }),
    [graph],
  );

  const handleNodeClick = useCallback((node) => {
    setSelected(node.id);
    setBlastRadius(null);
    setBlastRadiusError(null);
    fetchBlastRadius({ service: node.id })
      .then((rows) => setBlastRadius(rows))
      .catch((err) => setBlastRadiusError(err.message));
  }, []);

  const nodeColor = useCallback(
    (node) => {
      const up = liveness[node.id];
      if (up === true) return colors.up;
      if (up === false) return colors.down;
      return colors.unknown;
    },
    [liveness, colors],
  );

  // Selection is drawn as a ring on top of the default node paint, rather
  // than by swapping the node's fill colour, so a selected node keeps
  // showing its actual liveness state instead of hiding it behind an
  // "is selected" colour.
  const paintSelectionRing = useCallback(
    (node, ctx) => {
      if (node.id !== selected || node.x == null || node.y == null) return;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 7, 0, 2 * Math.PI);
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    [selected, colors],
  );

  return (
    <section className="map-page">
      <div className="map-toolbar">
        {error && <span className="overview-error">{error}</span>}
        {graph.nodes.length === 0 && !error && <p className="overview-empty">No topology reported yet.</p>}
      </div>

      <div className="map-layout">
        <div className="map-graph" ref={containerRef}>
          {graph.nodes.length > 0 && (
            <ForceGraph2D
              graphData={graphData}
              width={size.width}
              height={size.height}
              nodeLabel={(node) => `${node.id} (${node.tier})`}
              nodeColor={nodeColor}
              nodeRelSize={5}
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={paintSelectionRing}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              linkColor={() => colors.unknown}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        <aside className="map-panel">
          {!selected && <p className="overview-empty">Click a node to see its blast radius.</p>}
          {selected && (
            <>
              <h3>{selected}</h3>
              {blastRadiusError && <p className="overview-error">{blastRadiusError}</p>}
              {!blastRadiusError && blastRadius == null && <p>loading…</p>}
              {!blastRadiusError && blastRadius != null && blastRadius.length === 0 && (
                <p>No services depend on {selected}.</p>
              )}
              {!blastRadiusError && blastRadius != null && blastRadius.length > 0 && (
                <ul className="blast-radius-list">
                  {blastRadius.map((row) => (
                    <li key={row.service}>
                      <span className={`tier tier-${row.tier}`}>{row.tier}</span>
                      <span className="blast-radius-service">{row.service}</span>
                      <span className="blast-radius-hops">{row.hops} hop{row.hops === 1 ? '' : 's'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
