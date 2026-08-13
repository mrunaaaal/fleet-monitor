export function startInterval(intervalMs, onTick) {
  const timer = setInterval(onTick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
