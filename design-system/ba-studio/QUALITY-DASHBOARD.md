# Quality dashboard refinement — 2026-10-15

The user identified a dense technical-log presentation in the quality/cost section. Replaced unstyled stacked metrics and red summary paragraphs with four KPI cards, requirement-coverage bars, a separate AI-usage definition list, and expandable findings/history tables.

UI UX Pro Max search: `dashboard status color hierarchy --domain ux`. Applied color-plus-text status semantics and readable contrast. REVIEW is amber, BLOCK is rose, PASS is green; neutral metrics are not errors.

Presentation only: backend quality calculation, gates, telemetry and project state are unchanged. Null usage/pricing remains unknown; zero remains zero. Known cost is labeled as a partial recorded value. Latency is displayed in seconds with p95 sample size. Automated scores do not imply BA/customer signoff. All existing finding/history fields remain available, with the existing 20-finding limit made visible.

Verified locally with Chrome/Playwright at 1440, 768 and 375px: no viewport overflow, four KPIs, four coverage rates, unknown cost retained, details toggle and no page errors. Desktop and mobile screenshots visually inspected. Existing regression and offline quality/Figma/production/workspace suites run; no live provider or Figma mutation triggered.
