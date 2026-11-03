// Keep in sync with apps/web/worker/session/redact.ts (checked by redact.test.mjs).
export const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{20,}/g, // OpenAI, Anthropic, Stripe, OpenRouter
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, /\bxapp-[0-9]-[A-Za-z0-9-]{10,}/g, // Slack app-level token // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bya29\.[0-9A-Za-z_-]{20,}/g, // Google OAuth access token
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b0B(?:-[A-Z2-7]{4}){13}\b/g,
  /\b0b_[A-Za-z0-9_-]{20,}/g,
  /\bbx[a-z]_[A-Za-z0-9_-]{20,}/g, // Boarder tokens
  /(?<=\bBearer\s+)[A-Za-z0-9._~+\/=-]{16,}/g, // Authorization Bearer values
  /(?<=:\/\/[^\s/:@]+:)[^\s/@]{6,}(?=@)/g,
  /(?<=\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|KEK|HMAC|CREDENTIAL|SIGNING_?KEY|ENCRYPTION_?KEY)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)[^\s"'`,;]{8,}/gi,
];

const SECRET_NAME = /(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|KEK|HMAC|CREDENTIAL|SIGNING_?KEY|ENCRYPTION_?KEY)/i;

export function redact(text) {
  for (const re of SECRET_PATTERNS) text = text.replace(re, '[secret]');
  return text;
}

// Parse first so masking never damages JSON escapes or changes object keys.
export function redactLine(line) {
  try {
    // {"BOARDER_DATA_KEK_1": "값"} 은 키와 값이 따로 와 이름 규칙이 안 걸리므로 키 이름도 본다
    return JSON.stringify(JSON.parse(line, (key, value) => typeof value !== 'string' ? value : SECRET_NAME.test(key) && value.length >= 8 ? '[secret]' : redact(value)));
  } catch {
    return redact(line);
  }
}
