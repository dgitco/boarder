export const addr = (a: { name?: string; address?: string } | undefined) => (!a ? undefined : a.name && a.address ? `${a.name} <${a.address}>` : (a.address ?? a.name));
export const addrs = (l: { name?: string; address?: string; group?: unknown[] }[] | undefined) => (l?.length ? l.map((x) => addr(x as { name?: string; address?: string })).filter(Boolean).join(", ") : undefined);

/** HTML as plain text, for mail with no text part. */
export function htmlText(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => (Number(n) > 0 && Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "\ufffd"))
    .replace(/&amp;/gi, "&")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}
