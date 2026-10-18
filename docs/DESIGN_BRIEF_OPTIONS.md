# Selectable Design Brief

The Prototype Design Brief uses selectable visual preferences rather than requiring prose. The versioned catalog in `public/design-brief-options.js` is shared by browser and server. Its eight starting styles are Modern SaaS, Bento, Material 3 Expressive, Fluent, Editorial, Soft Minimal, Dark Pro and Subtle Glass. These are curated starting points, not a measured popularity ranking or a guarantee of visual quality.

Selecting a style fills goals, palette, font, density and avoid criteria. Each criterion can then be changed separately. Audience/context is deliberately never inferred from a style; switching presets retains the explicitly selected context. Platform selection and individual-screen revision remain independent. References, assets and sample review still follow the existing Figma handoff process.

The catalog draws on UI UX Pro Max and current primary design-system guidance:

- [Material Design 3](https://m3.material.io/)
- [Fluent 2 principles](https://fluent2.microsoft.design/design-principles)
- [Atlassian typography](https://atlassian.design/foundations/typography) and [spacing](https://atlassian.design/foundations/spacing)

## Persistence and compatibility

`POST /api/projects/:id/design-direction` accepts `briefOptions` with `schemaVersion: ba.brief-options.v1`, a supported `catalogVersion`, choice IDs and optional `preserve` field names. The server validates every ID, rejects duplicates/unknown catalog versions, canonicalizes ordering and generates the actual brief text. A competing client `brief` cannot override that text. Goals and style are required in option mode.

Existing manual callers can continue sending the original `brief` object. Older free-text values appear as explicit “keep saved content” choices; they are never silently classified or discarded. The metadata migration stores selection IDs while keeping the digest unchanged when the actual visual brief is unchanged. Existing design bindings remain valid for such a migration. Any change to the actual visual inputs invalidates sample/design approval through the existing guards.

Selections express visual preferences only. They do not approve business requirements, resolve clarification questions or establish customer signoff. Font choices express design intent; actual availability or a recorded fallback must be verified in Figma. The operator must still review the sample and resulting screens.

## Verification

`tests/design-brief-options.test.js` covers catalog resolution, invalid inputs, canonical ordering and compatibility. `tests/design-direction-http.test.js` covers server persistence and no-op saves alongside the existing sample gate tests. The isolated browser check in ignored `data/setup-evidence/brief-options-browser.mjs` exercises selecting, customizing, platform switching, save/reload, keyboard focus and 375px layout without external model or Figma jobs.
