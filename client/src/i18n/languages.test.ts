import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { enUS } from 'date-fns/locale/en-US';
import { FALLBACK_LANGUAGE, resolveLanguage, type Language } from './languages';

const language = (code: string, listed = true): Language => ({
  code,
  name: code,
  dateLocale: enUS,
  resources: {},
  listed,
});

// English and Dutch listed, German in the build but not complete yet
const LANGUAGES = [language('en'), language('nl'), language('de', false)];
const codes = LANGUAGES.map((l) => l.code);

const knownTag = fc.constantFrom('en', 'en-US', 'en-GB', 'nl', 'nl-NL', 'nl-BE', 'de', 'de-DE');
const unknownTag = fc.constantFrom('fr', 'fr-FR', 'es-ES', 'pt-BR', 'zh-Hant-TW', 'ja');
const anyTag = fc.oneof(knownTag, unknownTag, fc.string());
const device = fc.array(anyTag, { maxLength: 5 });

describe('resolveLanguage (property-based)', () => {
  it('always gives a language the build has', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant('auto'), anyTag), device, (preference, tags) => {
        expect(codes).toContain(resolveLanguage(preference, tags, LANGUAGES));
      }),
    );
  });

  it('gives a chosen language the build has, and English for one it doesn’t', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...codes), unknownTag), device, (chosen, tags) => {
        expect(resolveLanguage(chosen, tags, LANGUAGES)).toBe(
          codes.includes(chosen) ? chosen : FALLBACK_LANGUAGE,
        );
      }),
    );
  });

  it('Automatic picks the first of the device’s languages that is listed', () => {
    fc.assert(
      fc.property(device, (tags) => {
        const first = tags
          .map((tag) => {
            try {
              return new Intl.Locale(tag).language;
            } catch {
              return undefined;
            }
          })
          .find((base) => base === 'en' || base === 'nl');
        expect(resolveLanguage('auto', tags, LANGUAGES)).toBe(first ?? FALLBACK_LANGUAGE);
      }),
    );
  });

  it('Automatic never picks a language that isn’t listed', () => {
    fc.assert(
      fc.property(device, (tags) => {
        expect(resolveLanguage('auto', ['de-DE', ...tags], LANGUAGES)).not.toBe('de');
      }),
    );
  });

  it('a language the device prefers less doesn’t change the choice', () => {
    const listedTag = fc.constantFrom('en', 'en-US', 'en-GB', 'nl', 'nl-NL', 'nl-BE');
    fc.assert(
      fc.property(listedTag, device, (tag, tags) => {
        expect(resolveLanguage('auto', [tag, ...tags], LANGUAGES)).toBe(
          resolveLanguage('auto', [tag], LANGUAGES),
        );
      }),
    );
  });

  it('works through examples', () => {
    expect(resolveLanguage('auto', ['nl-BE', 'en-US'], LANGUAGES)).toBe('nl');
    expect(resolveLanguage('auto', ['fr-FR', 'nl-NL'], LANGUAGES)).toBe('nl');
    expect(resolveLanguage('auto', ['de-DE', 'fr-FR'], LANGUAGES)).toBe('en');
    expect(resolveLanguage('auto', [], LANGUAGES)).toBe('en');
    expect(resolveLanguage('de', ['nl-NL'], LANGUAGES)).toBe('de');
    expect(resolveLanguage(undefined, ['nl-NL'], LANGUAGES)).toBe('nl');
  });
});
