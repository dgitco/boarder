export const BUNDLES = [
  ["board", true], ["work-tools", true], ["guards", true], ["skills", true], ["rules", true], ["timers", true],
  ["phone-alert", false], ["external-send", false], ["account-autoswitch", false],
  ["priority-file", true], ["switch-confirm", true], ["input-log", true], ["one-memory", true], ["signals-first", true], ["qa-evidence", true], ["kickoff", true], ["company-assistant", true], ["session-panel", true], ["personal-assistant", true],
  ["experimental", false],
] as const;
export const BUNDLE_KEYS = BUNDLES.map(b => b[0]) as readonly string[];
export const BUNDLE_DEF: Record<string, boolean> = Object.fromEntries(BUNDLES);
