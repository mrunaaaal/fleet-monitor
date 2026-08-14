import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// fleet-monitor-docs.md §10: "Recharts line charts, one panel per service,
// 15s polling" — an area chart (mean line, min/max band) reads the same
// way but shows spread at a glance, which a bare line can't.
export default function MetricChart({ rows, unit }) {
  if (!rows || rows.length < 2) {
    return <div className="metric-chart metric-chart-empty">collecting…</div>;
  }

  const data = rows.map((r) => ({
    bucket: r.bucket,
    mean: r.mean,
    band: r.min != null && r.max != null ? [r.min, r.max] : undefined,
  }));

  return (
    <ResponsiveContainer width="100%" height={80} className="metric-chart">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <XAxis dataKey="bucket" hide />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip
          formatter={(value) => (Array.isArray(value) ? value.map((v) => v?.toFixed?.(1)).join(' – ') : value?.toFixed?.(1))}
          labelFormatter={(bucket) => new Date(bucket).toLocaleString()}
          contentStyle={{ fontSize: 12 }}
        />
        <Area type="monotone" dataKey="band" stroke="none" fill="var(--accent)" fillOpacity={0.15} isAnimationActive={false} />
        <Area
          type="monotone"
          dataKey="mean"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="none"
          isAnimationActive={false}
          unit={unit}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
