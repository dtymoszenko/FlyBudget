// Finds text people see that's written in the code instead of src/i18n/locales/en.json, and
// checks en.json itself. `npm run check:i18n` lists what's left per file; `-- --list` shows
// each one. It fails for text in the ENFORCED paths (the ones already translated) and for
// problems in en.json. Put `// i18n-ignore` on the line above something that isn't text
// people read (a date pattern, a brand name).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'vite';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const LIST = process.argv.includes('--list');
// Also lists other strings that look like words for people ("Online", 'Demo in this browser'),
// such as text kept in a variable first. Only a hint: it never fails.
const LOOSE = process.argv.includes('--loose');

/** Paths (relative to src/, a folder ends in /) whose text must come from the translations */
const ENFORCED = [
  'i18n/',
  'components/auth/',
  'components/connection/',
  'components/currency/',
  'components/demo/',
  'components/enablebanking/',
  'components/goals/',
  'components/layout/',
  'components/reports/AccountMultiSelect.tsx',
  'components/reports/CategoryTreePicker.tsx',
  'components/reports/ChartTypeSelector.tsx',
  'components/reports/ReportBuilderSidebar.tsx',
  'components/reports/ReportDetail.tsx',
  'components/reports/ReportTable.tsx',
  'components/reports/SaveReportModal.tsx',
  'components/reports/SavedReportsList.tsx',
  'components/settings/AccountReorder.tsx',
  'components/settings/ConnectedAccounts.tsx',
  'components/settings/CurrencySettings.tsx',
  'components/settings/DataExport.tsx',
  'components/settings/PreferencesPanel.tsx',
  'components/settings/ServerSettings.tsx',
  'components/ui/',
  'hooks/useCustomReports.ts',
  'hooks/useEnableBanking.ts',
  'hooks/useGoals.ts',
  'pages/CustomReportBuilder.tsx',
  'pages/Goals.tsx',
  'pages/Settings.tsx',
  'pages/Welcome.tsx',
  'utils/connection.ts',
];

/** JSX attributes and object properties that hold text people read */
const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'confirmLabel',
  'description',
  'emptyText',
  'hint',
  'label',
  'message',
  'placeholder',
  'searchPlaceholder',
  'submitLabel',
  'title',
  'tooltip',
]);
const TEXT_PROPERTIES = new Set([
  'description',
  'hint',
  'label',
  'long',
  'message',
  'placeholder',
  'text',
  'title',
  'tooltip',
]);
/** State setters whose argument is shown */
const TEXT_SETTERS = /^set(Error|Notice|Message|Status|Warning|Info)$/;
/** Names that stay as they are in every language */
const NOT_TEXT = /^(FlyBudget|Plaid|SimpleFIN|Enable Banking|GitHub|Docker|CSV|CAMT|OFX|QIF|API)$/;

/** Where a capitalized string is a value to compare or a module, not text (for --loose) */
const NOT_LOOSE_PARENTS = new Set([
  'BinaryExpression',
  'SwitchCase',
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
  'JSXAttribute',
  'TSLiteralType',
]);

/** Has a word of two letters or more (not a symbol, number or single letter) */
const hasWords = (s) => /\p{L}{2,}/u.test(s) && !NOT_TEXT.test(s.trim());

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Strings in an expression that end up shown: 'a', `a ${b}`, x ? 'a' : 'b', x || 'a' */
function textsIn(node) {
  if (!node) return [];
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' && hasWords(node.value) ? [node.value] : [];
    case 'TemplateLiteral': {
      const s = node.quasis.map((q) => q.value.cooked).join('…');
      return hasWords(s) ? [s] : [];
    }
    case 'ConditionalExpression':
      return [...textsIn(node.consequent), ...textsIn(node.alternate)];
    case 'LogicalExpression':
      return [...textsIn(node.left), ...textsIn(node.right)];
    case 'JSXExpressionContainer':
      return textsIn(node.expression);
    default:
      return [];
  }
}

const isFunction = (n) =>
  n.type === 'FunctionDeclaration' ||
  n.type === 'FunctionExpression' ||
  n.type === 'ArrowFunctionExpression' ||
  n.type === 'MethodDefinition';
const isTCall = (n) =>
  n.type === 'CallExpression' &&
  ((n.callee.type === 'Identifier' && n.callee.name === 't') ||
    (n.callee.type === 'MemberExpression' &&
      n.callee.property.name === 't' &&
      n.callee.object.name === 'i18n'));

/** Every finding in one file: { line, kind, text } */
function check(path, source) {
  const { program, comments } = parseSync(path, source);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const ignored = new Set(
    comments.filter((c) => c.value.trim() === 'i18n-ignore').map((c) => lineOf(c.end) + 1),
  );
  const findings = [];
  const report = (node, kind, texts) => {
    // JSX text starts at the line break before it: count from its first word
    const lead = node.type === 'JSXText' ? node.value.length - node.value.trimStart().length : 0;
    const line = lineOf(node.start + lead);
    if (ignored.has(line)) return;
    for (const raw of texts) {
      const text = raw.trim().replace(/\s+/g, ' ');
      if (!findings.some((f) => f.line === line && f.text === text))
        findings.push({ line, kind, text });
    }
  };

  const walk = (node, inFunction, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      LOOSE &&
      (node.type === 'Literal' || node.type === 'TemplateLiteral') &&
      !NOT_LOOSE_PARENTS.has(parent?.type) &&
      !(parent?.type === 'Property' && parent.key === node)
    ) {
      const s =
        node.type === 'Literal' ? node.value : node.quasis.map((q) => q.value.cooked).join('…');
      if (typeof s === 'string' && /^[A-Z][a-z]+(?=[\s,.!?…:'’]|$)/.test(s) && hasWords(s)) {
        report(node, 'loose', [s]);
      }
    }
    switch (node.type) {
      case 'JSXText':
        if (hasWords(node.value)) report(node, 'text', [node.value]);
        break;
      case 'JSXExpressionContainer':
        if (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment') {
          report(node, 'text', textsIn(node.expression));
        }
        break;
      case 'JSXAttribute':
        if (TEXT_ATTRIBUTES.has(node.name.name)) report(node, node.name.name, textsIn(node.value));
        break;
      case 'Property': {
        const key = node.key.name ?? node.key.value;
        // A prop's default text: function X({ confirmLabel = 'Confirm' })
        if (node.value?.type === 'AssignmentPattern') {
          if (TEXT_PROPERTIES.has(key) || TEXT_ATTRIBUTES.has(key)) {
            report(node, key, textsIn(node.value.right));
          }
        } else if (TEXT_PROPERTIES.has(key)) report(node, key, textsIn(node.value));
        break;
      }
      case 'CallExpression':
        if (node.callee.type === 'Identifier' && TEXT_SETTERS.test(node.callee.name)) {
          report(node, node.callee.name, textsIn(node.arguments[0]));
        }
        if (!inFunction && isTCall(node)) report(node, 't() when the module loads', ['t(…)']);
        break;
    }
    const inside = inFunction || isFunction(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => walk(child, inside, node));
      else if (value && typeof value === 'object') walk(value, inside, node);
    }
  };
  walk(program, false, null);
  return findings;
}

// --- en.json ---------------------------------------------------------------------------------

const PLURAL = /_(zero|one|two|few|many|other)$|_ordinal_(zero|one|two|few|many|other)$/;
// <Trans> drops what's inside these, because in HTML they can't have content
const VOID_TAGS = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value, `${prefix}${key}.`),
  );
}

function checkEnglish(english, sources) {
  const problems = [];
  const entries = flatten(english);
  // Keys the code mentions: 'a.b.c' as a string, or `a.${x}.c` as a pattern
  const KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;
  const used = new Set();
  const patterns = [];
  for (const source of sources) {
    for (const [, literal] of source.matchAll(/['"]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)['"]/g)) {
      used.add(literal);
    }
    for (const [, template] of source.matchAll(/`([a-z][A-Za-z0-9.]*\$\{[^`]*)`/g)) {
      const pattern = template
        .split(/\$\{[^}]*\}/)
        .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
        .join('[A-Za-z0-9_]+');
      patterns.push(new RegExp(`^${pattern}$`));
    }
  }
  const bases = new Map();
  for (const [key, value] of entries) {
    const base = key.replace(PLURAL, '');
    if (!used.has(base) && !used.has(key) && !patterns.some((p) => p.test(base))) {
      problems.push(`${key}: not used in the code`);
    }
    if (base !== key) bases.set(base, [...(bases.get(base) ?? []), key.slice(base.length)]);
    if (value !== value.trim()) problems.push(`${key}: space at the start or end`);
    const open = [...value.matchAll(/<([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => m[1]);
    const close = [...value.matchAll(/<\/([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => m[1]);
    if (open.sort().join() !== close.sort().join()) problems.push(`${key}: unbalanced tags`);
    for (const tag of open.filter((name) => VOID_TAGS.has(name.toLowerCase()))) {
      problems.push(`${key}: <${tag}> is an empty HTML element, so its text is lost; rename it`);
    }
    if (!KEY.test(key.replace(PLURAL, ''))) problems.push(`${key}: not a valid key name`);
  }
  for (const [base, forms] of bases) {
    const cardinal = forms.filter((f) => !f.startsWith('_ordinal'));
    if (cardinal.length && !(cardinal.includes('_one') && cardinal.includes('_other'))) {
      problems.push(`${base}: a plural needs _one and _other`);
    }
  }
  return problems;
}

// --- report ----------------------------------------------------------------------------------

const files = sourceFiles(SRC);
const sources = files.map((path) => readFileSync(path, 'utf8'));
let enforcedCount = 0;
let total = 0;
const rows = [];
files.forEach((path, i) => {
  const rel = relative(SRC, path).split(sep).join('/');
  const all = check(path, sources[i]);
  const findings = all.filter((f) => f.kind !== 'loose');
  if (!all.length) return;
  const enforced = ENFORCED.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
  total += findings.length;
  if (enforced) enforcedCount += findings.length;
  rows.push([rel, findings, enforced, all]);
});

rows.sort((a, b) => b[1].length - a[1].length);
for (const [rel, findings, enforced, all] of rows) {
  if (!LIST && !(enforced && findings.length)) continue;
  console.log(`${enforced && findings.length ? '✗' : ' '} ${rel}: ${findings.length}`);
  for (const f of LIST ? all : findings) console.log(`    ${f.line}  ${f.kind}: ${f.text}`);
}

const english = JSON.parse(readFileSync(join(SRC, 'i18n/locales/en.json'), 'utf8'));
const problems = checkEnglish(english, sources);
for (const p of problems) console.log(`✗ en.json ${p}`);

console.log(
  `\n${total} texts in ${rows.length} files still in the code` +
    (enforcedCount ? `, ${enforcedCount} in translated files` : '') +
    (problems.length ? `; ${problems.length} problems in en.json` : ''),
);
if (enforcedCount || problems.length) process.exit(1);
