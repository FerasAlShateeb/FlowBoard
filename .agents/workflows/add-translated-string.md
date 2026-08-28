# Workflow: Add a translated string

Every user-facing string in FlowBoard goes through i18next, in English **and**
Arabic, with full RTL. This is the operational recipe; `i18n.md` → the catalogs
and the binding Arabic glossary are the full treatment, and the glossary is not
optional reading before you write Arabic copy. Worked from
`locales/en/board.ts` + `locales/ar/board.ts` (no plurals, by design) and
`locales/en/orgs.ts` + `locales/ar/orgs.ts` (the reference plural pair).

## Steps

1. **Pick the namespace.** One per feature area, as a **TypeScript module**
   (`apps/web/src/locales/en/<ns>.ts`) with a `default export` object — not JSON.
   That is what lets `i18n/i18next.d.ts` declare `resources: typeof en`, so a
   key that does not exist is a _compile error_ rather than a key rendered on
   screen. A new namespace is imported and listed in `locales/en/index.ts` **and**
   `locales/ar/index.ts`; `NAMESPACES` in `i18n/index.ts` is derived from the
   English catalog, so nothing else needs editing.

2. **Name the key for the MEANING, not the text.** `board.column.wipExceeded`,
   never `board.redWarning`. Nest area → component → purpose, and keep a short
   comment above anything whose intent is not obvious from the key.

3. **Add the English value.** English is the shape authority: it is the
   `fallbackLng`, it types `t()`, and Arabic must never introduce a key English
   does not have.

4. **Add the Arabic value, key for key.** If it does not pluralize, one string.
   **If it pluralizes, English declares exactly `_one` and `_other`, and Arabic
   declares ALL SIX CLDR categories** — this is the one asymmetry
   `i18n/locales.test.ts` permits, and it exists because of a real shipped bug:
   an Arabic catalog carrying only `_one`/`_other` left i18next with no form for
   `count: 3`, so it fell back to the **English** string inside an Arabic
   sentence ("Exported 11 tasks." in a right-to-left toast).

   ```ts
   // locales/en/orgs.ts
   members_one: '{{count}} member',
   members_other: '{{count}} members',

   // locales/ar/orgs.ts — zero, one, two, few (3–10), many (11–99), other (100+)
   members_zero: 'لا أعضاء',
   members_one: 'عضو واحد',
   members_two: 'عضوان',
   members_few: '{{count}} أعضاء',
   members_many: '{{count}} عضوًا',
   members_other: '{{count}} عضو',
   ```

   **Or avoid the plural entirely**, which is what `board` does on purpose: a
   count renders as a bare figure inside a labelled accessible name
   (`count: 'Cards: {{count}}'`), which reads correctly in both languages and
   both directions. Prefer this for chips and badges; use real plurals for
   sentences.

5. **Use it via `useTranslation`.** Declare every namespace the component reads
   and prefix the keys, so a move between files cannot silently change meaning:

   ```ts
   const { t } = useTranslation(['calendar', 'common']);
   t('calendar:toast.rescheduled', { key: 'FLOW-142' });
   ```

6. **Interpolate — never concatenate.** `t('key', { count, name })`, one call per
   sentence. Word order differs between English and Arabic, and a string built
   from two `t()` calls plus a `+` cannot be reordered by a translator. Values
   with a fallback get one: `actorName ?? t('notifications:fallback.someone')`,
   as in `components/notifications/notification-sentence.ts` — an `undefined`
   interpolated into the middle of a line is not a sentence.

7. **Numbers and dates go through `lib/format.ts`**, with the locale from
   `lib/lang-policy.getIntlLocale()` passed as a **parameter** (those helpers
   never read the policy themselves, so they stay pure and testable in both
   locales). Arabic resolves to `ar-u-nu-latn`, so digits stay Western — not a
   stylistic call: the table and the backlog chips are `tabular-nums` columns and
   a digit-set swap between rows breaks their alignment. A calendar day is the
   string `YYYY-MM-DD`, never a `Date`.

8. **A form never translates its own field errors.** Web forms validate with the
   same shared zod schemas the API uses, and those carry English text because
   that text is the wire contract (it comes back verbatim in a 422's
   `error.details`). Translation happens at the last possible moment:
   `components/ui/form.tsx`'s `FormMessage` runs every message through
   `localizeValidationMessage` from `apps/web/src/i18n/validation.ts`, whose
   `Record<ValidationMessage, ValidationKey>` map makes a new shared message a
   compile error until it has a key. Add the message to
   `packages/shared/src/validation-messages.ts`, the key to
   `locales/{en,ar}/validation.ts`, and the pair to that map — never a `t()` call
   in the form.

9. **Run the parity test**: `pnpm --filter @flowboard/web test src/i18n/locales.test.ts`.
   It diffs leaf keys both ways — missing in Arabic is a silent English leak,
   extra in Arabic is dead weight from a half-landed rename — with the plural
   asymmetry of step 4 as the only exemption.

10. **Check it in RTL.** Switch to Arabic and look at it. Logical Tailwind
    utilities only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`), so the layout
    mirrors; the physical-property exceptions are enumerated in `i18n.md` → the
    physical-property exceptions and nothing outside that table qualifies. Any
    element rendering **user-generated** text (a task title, a comment body, a
    display name) gets `dir="auto"`, so an English title inside an Arabic page
    still reads left to right.

## Checklist

- [ ] Namespace is a `.ts` module, registered in both `locales/{en,ar}/index.ts`.
- [ ] Key names the meaning, nested area → component → purpose.
- [ ] English value added; Arabic value added key-for-key.
- [ ] Plurals: `_one`/`_other` in English, all six CLDR categories in Arabic — or no plural at all.
- [ ] Consumed via `useTranslation([...])` with namespace-prefixed keys.
- [ ] Interpolated, never concatenated; every optional value has a translated fallback.
- [ ] Numbers/dates via `lib/format.ts` with `getIntlLocale()`.
- [ ] Field errors left to `FormMessage` + `i18n/validation.ts`.
- [ ] `i18n/locales.test.ts` green.
- [ ] Logical utilities only; `dir="auto"` on user-generated text; checked in Arabic.

## Related

- [i18n.md](../docs/i18n.md) — the two layers, the binding Arabic glossary, plurals, RTL mechanics, LTR islands.
- [design-system.md](../docs/design-system.md) — RTL and the token layer.
- [add-view.md](./add-view.md) — creating a namespace for a new view.
- [coding-standards.md](../docs/coding-standards.md) — zod at both ends, which is why the schemas carry English.

Back to [workflows/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
