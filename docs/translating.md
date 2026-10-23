# Translating Plinthio

Plinthio's interface is available in English, German, Spanish, French, Italian, Dutch, Polish,
Brazilian Portuguese, Japanese, Korean and Simplified Chinese.
Each person picks their language in **Settings → Appearance → Language** (it's saved to their
account); before signing in, the sign-in page and setup wizard have a language switch. For
anyone who hasn't picked, **Admin → Appearance → Default language** applies, and its
**Automatic** follows each browser.

## Where the strings live

```
frontend/src/locales/
  en/  common.json  appearance.json  title.json  …   ← English, the source of truth
  fr/  …  de/  …  es/  …  ja/  …  ko/  …              ← the same files, translated
```

Each file is a *namespace*. A key is `namespace.path.to.message`, so `t('title.play')` reads
`"play"` from `title.json`. `common.json` holds the words every screen needs (Save, Cancel,
Close, Loading…, media type names); use those rather than defining your own.

English is bundled with the app and is the fallback: a key missing from a translation shows
the English text, never a blank.

## In code

Templates use `$t`, scripts import `t` from `src/i18n`:

```vue
<button>{{ $t('common.save') }}</button>
<input :placeholder="$t('settings.profile.namePlaceholder')" />
```

```js
import { t, d, n } from '@/i18n';
showError(t('title.errors.couldNotLoad'));
```

- **Placeholders** are `{name}`: `"Saved {count} titles to {list}"` with
  `t('lists.saved', { count, list: name })`.
- **Plurals** are an object keyed by [plural category](https://cldr.unicode.org/index/cldr-spec/plural-rules),
  chosen from `params.count`:
  `"episodes": { "one": "{count} episode", "other": "{count} episodes" }`.
  German, Dutch, French, Spanish, Italian and Portuguese use `one`/`other` (the Romance
  languages' `many` is only for round millions, so `other` covers it); Polish needs
  `one`/`few`/`many`/`other`; Japanese, Korean and Chinese only need `other`. The check below
  fails if a language is missing a form it needs.
- **Markup inside a sentence** (a link, `<code>`, bold): don't split the sentence. Use
  `<I18nT>` with a slot per placeholder so translators can move it:
  ```vue
  <I18nT keypath="docs.install.pullHint" tag="p">
    <template #command><code>docker compose pull</code></template>
  </I18nT>
  ```
- **Dates and numbers**: `d(date, { dateStyle: 'medium' })`, `n(1234)`, `relative(-3, 'day')`
  and `list(['a', 'b'])` format in the reader's language. Don't call
  `toLocaleDateString()` without a locale.
- **Text computed outside a component** (constants, stores, utils) must call `t()` when the
  text is *used*, not when the module loads, or it stays in whatever language was active
  at startup. Use a getter (`get label() { return t('…'); }`) or a function. Copying an
  object with a getter (`{ ...option }`) freezes today's wording — map inside a `computed`.
- Not translated: the name Plinthio, people's library/list/title names, and product or
  protocol names (TMDB, Tailscale, Funnel, EPUB, PDF, KOReader, Mihon, OPDS, HTTPS…).
- **Messages from the server** arrive in English and are translated in the web app, from
  `serverErrors.json` (see below).

## Server messages

The server always answers in English. `src/i18n/serverErrors.js` turns its errors and
confirmations into the reader's language as they arrive, so screens just show
`err.response.data.error` as before (`errorEnglish` keeps the original). `serverErrors.json`
has three groups:

- `codes.P###`: the catalog in `backend/src/errors.js` (title, message, meaning, fix), which is
  also the error reference on the Docs page.
- `messages.<key>`: the other fixed messages routes send, matched on their exact English text.
- `patterns.<key>`: the few built at runtime, matched with their `{placeholders}`.

When you add or change a server message, add or change it in `en/serverErrors.json` too (and
the other languages). `check:i18n` fails if a code's English differs from `errors.js`, or if a
listed message is no longer sent anywhere. A message that isn't listed still works; it just
stays in English. Developer-only validation messages (`itemId is required`) don't need listing.

## Style

Match the English voice: plain, friendly, short. Sentence case in every language.

| Language | Address | Notes |
| --- | --- | --- |
| French | *vous* | Non-breaking space before `: ; ! ?` is optional; keep it consistent within a string. |
| German | *du* | Compound nouns are long — prefer a shorter word over one that breaks a button. |
| Spanish | *tú* | Neutral international Spanish. |
| Japanese | です／ます | Katakana for loanwords used in apps (ライブラリ, プレーヤー). No spaces between words. |
| Korean | 해요체 | Labels and buttons are nouns or short verbs (저장, 취소). |
| Italian | *tu* | |
| Dutch | *je* | |
| Polish | *ty* | Buttons in the imperative (Zapisz, Anuluj). |
| Portuguese (Brazil) | *você* | Brazilian spelling and vocabulary (tela, arquivo, baixar). |
| Simplified Chinese | 你 | Full-width punctuation (，。：); no spaces between Chinese and numbers. |

## Checking

```
cd frontend
npm run check:i18n           # every language has every key, placeholders match,
                             # and every t('…') used in code exists
npm run check:i18n -- title  # just one namespace
```

CI runs the same check. To add a language: add its folder under `src/locales/` with every
namespace file, and an entry in `LANGUAGES` in `src/i18n/index.js`.
