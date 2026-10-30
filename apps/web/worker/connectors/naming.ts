
export const SEP = "__";
/**
 * Claude Code rejects tools whose full name `mcp__<server>__<tool>` exceeds 64 characters.
 * Our entry is named "boarder" (`mcp__boarder__` = 14), which leaves 50.
 */
export const NAME_BUDGET = 50;

/** Short stable hash to keep shortened names unique. */
export function hash4(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36).slice(-4);
}

export function exposedName(prefix: string, tool: string): string {
  const t = tool.replace(/[^A-Za-z0-9_-]/g, "_");
  const full = `${prefix}${SEP}${t}`;
  if (full.length <= NAME_BUDGET) return full;
  const [service, label] = prefix.split(SEP) as [string, string | undefined];
  if (label) {
    const room = NAME_BUDGET - service.length - t.length - 2 * SEP.length;
    if (room >= 3) return `${service}${SEP}${label.slice(0, room)}${SEP}${t}`;
  }
  return `${full.slice(0, NAME_BUDGET - 5)}_${hash4(full)}`;
}
