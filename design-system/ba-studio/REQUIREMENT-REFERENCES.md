# Requirement reference details

Inline FR references in clarification summaries expose a bounded, scrollable detail popover. Mouse hover and keyboard focus open a preview; click/tap pins it. Escape, an explicit close button and outside pointer dismissal are supported. The trigger does not toggle the parent question. Touch targets expand to 44px on coarse pointers. Dialog semantics are used because the detail contains a close button and a scrollable list, rather than a text-only tooltip.

UI UX Pro Max search `tooltip hover keyboard touch --domain ux` supported providing tap access and touch spacing. Requirements resolve exclusively from current project analysis. Missing references are disclosed; source text is never rendered as HTML. Dashes and abbreviated/full FR ranges are supported without iterating unbounded numeric ranges.

Browser checks used synthetic local fixtures, with no customer writes or provider calls: range lookup, missing IDs, hover persistence, keyboard focus/Escape, pin/close/outside dismissal, parent-summary isolation, 375px viewport bounds, scrolling and emulated touch. Desktop/mobile screenshots were inspected. Native Popover API requires a modern browser.
