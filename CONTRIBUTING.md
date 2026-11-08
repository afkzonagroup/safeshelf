# Contributing to Safeshelf

Thank you for helping. Please read this first.

## Before you start

- **Sign the CLA.** Every pull request needs a signed [Contributor Licence
  Agreement](CLA.md). Add the signature line from CLA.md to your first pull
  request. Without it we cannot merge.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security issues go to GitHub Security Advisories, not public issues
  ([SECURITY.md](SECURITY.md)).

## Development

```sh
npm ci
npx playwright-core install chromium-headless-shell
npm run check      # typecheck + lint + tests
npm run coverage   # tests with coverage report in coverage/
```

Node.js 22 or later. Tests start local fixture servers on 127.0.0.1 and use
Playwright's bundled Chromium.

## Rules for changes

- **Legal accuracy.** Every rule cites the exact provision and links the
  official EUR-Lex text. Read the official text, not summaries. Results say
  what Safeshelf found or did not find; never "unsafe", "illegal" or
  "non-compliant".
- **Phrases are data.** Label phrases live in `src/data/labels.ts`. English
  entries are `source: 'original'`; any other language is
  `source: 'translation'` unless the words appear verbatim in that language
  version of GPSR Art. 19 (`'official-text'`, checked by
  `test/unit/legal.test.ts`). Native-speaker reviews of translations are very
  welcome: say which language you are native in.
- **Every detection change has tests**: a positive case, a negative case (a
  legitimate page that must not be read as the information, such as seller
  details or "manufacturer warranty"), and unit tests for the pure logic. Page
  fixtures live in `test/fixtures/shop`, feed fixtures in
  `test/fixtures/feeds`.
- **Security controls have tests that fail if the control is removed.** Do not
  weaken the network guard, the feed readers, CSV formula neutralisation or report escaping without
  discussing it in an issue first.
- TypeScript strict mode, no `any`, no `@ts-ignore`, no `eslint-disable`
  without a written reason, no `eval`/`new Function`/`innerHTML`.
- New runtime dependencies need a strong reason, an exact version and an entry
  in the README "Dependencies" section.
- Keep commits small, with clear messages. Update CHANGELOG.md.

## Pull request checklist

- [ ] CLA signed
- [ ] `npm run check` passes
- [ ] Tests added or updated, including a negative case (no false "found")
- [ ] Provision references checked against EUR-Lex
- [ ] README and CHANGELOG updated where behaviour changes
