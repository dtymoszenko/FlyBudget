/**
 * Logs an error on a single line. The detail is JSON-escaped, so text that came from a
 * request, a bank or Plaid (which may contain line breaks) can't forge extra log lines.
 */
export function logError(context: string, err: unknown) {
  const e = err as { response?: { data?: unknown }; message?: unknown } | undefined;
  const detail = e?.response?.data ?? e?.message ?? err;
  console.error('%s: %s', context, escapeLineSeparators(JSON.stringify(detail) ?? String(detail)));
}

// JSON escapes line feeds and carriage returns, but not the Unicode line and paragraph
// separators (U+2028, U+2029), which some log viewers also treat as line breaks
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

function escapeLineSeparators(text: string) {
  return text.replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}
