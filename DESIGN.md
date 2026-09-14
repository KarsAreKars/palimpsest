# DESIGN.md — Palimpsest Apothecary System

The binding visual contract for every Palimpsest surface. Forked surfaces
being reskinned must map to these tokens; do not introduce new ones without
updating this file. Upstream Readest code that has not been reskinned yet is
the migration backlog.

## Voice

The app speaks like a librarian, not an ad. Typed uppercase microcopy, no
exclamation marks, no emojis as icons (SVG only). Sell outcomes, never
machinery (no "sidecar", "venv", "pipeline" in user copy).

## Tokens (source of truth: `src/styles/apothecary.css`)

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F3EDE0` | App background, card surfaces |
| `--paper-light` | `#F8F4E9` | Raised/inset surfaces, inputs |
| `--ink` | `#26221B` | Primary text, hairline borders |
| `--muted` | `#6E6350` | Secondary text (darkened from `#8A7E6A` for AA 4.5:1) |
| `--faint` | `#C9BFA8` | Disabled ink, placeholder, decorative rules |
| `--stamp` | `#8C3B22` | THE only accent: primary actions, active states, the Prof's ink |
| `--cloth-*` (moss, basalt, oxblood, kraft, walnut, sage) | — | Book-cover cloth only; never UI chrome |
| `--oak`, `--oak-dark`, `--oak-light` | — | Wooden shelf (library) |
| `--lift-shadow` | `0 5px 14px rgba(42,37,29,.18)` | Floating layers only (menus, popovers, modals) |

Tailwind map already exists (`paper paperlight ink mutedink faint stamp oak`).
`mutedink` in components resolves to the corrected `--muted`.

## Typography

- Body: Newsreader (sans slot), 16–18px, 1.6 line-height.
- Display/titles: Fraunces (display slot).
- Microcopy/labels/keys: Special Elite via the `.typed` class — UPPERCASE,
  letter-spaced, 10–12px.

## Surfaces & components

- 1px `ink` hairlines (`.hairline`); corners stay sharp (≤2px radius).
- `.stamp-btn` primary action; `.ink-btn` secondary; `.paper-field` inputs.
- Progress: `.progress-track` / `.progress-fill` (stamp fill).
- Library shelf: `.oak-shelf`; book covers may use cloth palette.
- Floating layers use `--lift-shadow`; nothing else shadows.

## Hard rules

1. **No daisyUI tokens** (`btn-*`, `badge-*`, `card`, `bg-base-*`,
   `border-base-*`, `rounded-lg`) in any Palimpsest surface. The migration
   target class list: 168 files at audit time (2026-09-13).
2. Stamp is the only UI accent. Success may use cloth-moss sparingly
   (✓ VOICES READY, import OK). Nothing else.
3. Disabled: 40% ink, no hover inversion. `.stamp-btn:disabled` must be
   styled (it was not, at audit time).
4. `:focus-visible` = 2px stamp outline offset 2px, on every interactive
   element. Never rely on browser default.
5. Dark themes (`theme-dark` variant) and eink (`eink` variant) must keep
   working on every reskinned component.
6. Contrast: body text ≥ 4.5:1, large text ≥ 3:1, on paper surfaces.
