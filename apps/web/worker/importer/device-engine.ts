export const ENGINE_FRESH_MS = 120_000;
const parse = (s: string | null): Record<string, unknown> | null => { try { return s ? JSON.parse(s) as Record<string, unknown> : null; } catch { return null; } };
export function deviceFeatures(featuresJson: string | null, engineJson: string | null, engineAt: number | null, now = Date.now()): Record<string, unknown> | null {
  const f = parse(featuresJson);
  if (f?.engine) return f;
  const e = parse(engineJson);
  if (!e || e.harness || !engineAt || now - engineAt > ENGINE_FRESH_MS) return f;
  return { ...(f || {}), engine: true };
}
