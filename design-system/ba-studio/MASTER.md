# BA Studio interface — 2026-10-15

## Scope and design evidence
UI-only redesign of the existing vanilla HTML/CSS/JavaScript application. Preserve APIs, project/version binding, requirements, review gates, download actions, Figma setup/revision/gallery, and customer data.

UI UX Pro Max was queried with `project workspace calm approachable --design-system` and the narrower `enterprise SaaS dashboard --design-system`. The first matched Minimalism & Swiss Style but returned wellness typography; the second returned enterprise Plus Jakarta Sans typography and accessible blue/slate tokens. The landing-page Hero/CTA pattern is not suitable for this workspace and is not adopted. Glass effects are unnecessary for dense requirements; use opaque, readable surfaces. No verified recommendation is claimed for rejected results.

## Selected direction
- Light editorial workspace: white sidebar, cool neutral canvas, blue-violet accent, teal completion states.
- System sans-serif font stack for offline reliability and Vietnamese glyph coverage; enterprise sans-serif hierarchy inspired by the second result. No remote font dependency.
- 4/8px spacing rhythm, 14–16px body, 12px minimum metadata, 28–32px page titles, 18–20px section headings.
- One primary action per visual group. Muted secondary actions; green only for actual completed/approved state.
- Sidebar project search, persistent context header, horizontally scrollable project navigation, six-step workflow timeline.
- Welcome form plus short onboarding guidance; approved Figma previews in a two-column gallery on wide screens.
- Outline SVG icons with consistent stroke; decorative icons hidden from assistive technology.
- Visible keyboard focus, labeled fields, 44px controls, reduced-motion support, mobile navigation that retains projects and new-project action.

## Implementation plan
1. Replace shell markup and styling while preserving existing IDs and handlers.
2. Add project filtering, mobile navigation disclosure and accessible current-location cues.
3. Restyle shared forms, tables, status badges, workflow, documents and Figma previews; wrap wide tables in local scrolling regions.
4. Inspect welcome/workflow/analysis/documents/prototype/files at 1440, 1024, 768 and 375px. Exercise existing actions with intercepted writes or temporary fixtures, never mutate real customer data for visual testing.
5. Run repository regression/evaluations, capture screenshots, record continuity checkpoint and handoff.

## Constraints
No automatic customer signoff; no changed BA workflow transitions or provider behavior. Live Figma drawing is not needed for this UI-only task. Superpowers brainstorming/writing-plans skills were not found in installed skill roots; this explicit design and implementation plan records the chosen approach.
