import fs from 'fs';
import { fileURLToPath } from 'url';

// FlyBudget's version (the root package.json). Bundled builds get it from outside: the
// Docker image inlines FLYBUDGET_VERSION with esbuild's --define (see Dockerfile), and
// the desktop app passes Electron's app.getVersion() (electron/main.ts). `npm run dev`
// reads the root package.json.

const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,40}$/;

function fromRootPackage(): string | undefined {
  try {
    const file = fileURLToPath(new URL('../../../package.json', import.meta.url));
    const version: unknown = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    // Bundled (no import.meta.url there) or the file isn't around
    return undefined;
  }
}

export function resolveVersion(candidates: (string | undefined)[]): string {
  return candidates.find((v) => v !== undefined && VERSION_PATTERN.test(v)) ?? 'unknown';
}

export const appVersion = resolveVersion([
  process.env.FLYBUDGET_VERSION,
  fromRootPackage(),
  process.env.npm_package_version,
]);
