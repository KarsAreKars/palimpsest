# DESIGN.md — The Antiquarian Catalogue

The binding visual contract for every Palimpsest surface. The world: an
antiquarian bookseller's catalogue (direction contract:
`docs/direction-library.md`, product truth: `PRODUCT.md`). Every book is a
numbered plate; every surface is paper, ink, and one stamp. Written from the
shipped world after the 2026-09-14 overhaul and its two critique rounds.

## Voice

The app speaks like a librarian, not an ad. Typed uppercase microcopy, no
exclamation marks, no emojis as icons (SVG only). Sell outcomes, never
machinery (no "sidecar", "venv", "pipeline", "logs" in user copy).

## Tokens (source of truth: `src/styles/apothecary.css`)

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F3EDE0` | App background, card surfaces |
| `--paper-light` | `#F8F4E9` | Raised/inset surfaces, chips, inputs |
| `--ink` | `#26221B` | Primary text, hairline borders |
| `--muted` | `#6E6350` | Secondary text (AA 5.1:1 on paper). The ONLY microcopy ink — never alpha-blend ink for text |
| `--faint` | `#C9BFA8` | Disabled ink, placeholder, decorative rules |
| `--stamp` | `#8C3B22` | THE only accent: primary actions, active states, the Prof's ink |
| `--sage` | `#5B6B4F` | Secondary state ink (green-pencil annotations), rare |
| `--cloth-*` (moss, basalt, oxblood, kraft, walnut, sage) | — | Book-cover cloth only; never UI chrome |
| `--oak`, `--oak-dark`, `--oak-light` | — | Wooden shelf (library) |
| `--lift-shadow` | `0 5px 14px rgba(42,37,29,.18)` | Floating layers only (menus, popovers, modals). Nothing else shadows |

Dark flips these via `[data-theme='apothecary-dark']` (same file) — shelf at
night. Eink flattens lift shadows and thickens hairlines. Tailwind map:
`paper paperlight ink mutedink faint stamp oak`.

## Typography

- Body: Newsreader, 16–18px, 1.6 line-height.
- Display/titles: Fraunces via `.display-title` — small-caps, letter-spaced.
- Microcopy/labels/keys: Special Elite via `.typed` / `.plate-num` —
  UPPERCASE, letter-spaced, 9–12px.

## The plate system

- `.plate` — hairline double-rule frame (1px ink/25% outer, 1px ink/12%
  inset 3px). The catalogue unit: dialogs (`.plate-modal`), onboarding beats,
  pitch cards, the narration bar, the Prof's cards.
- `.plate-notch` — one ticket notch, top-right corner (12px cut).
- `.plate-interactive` — hover lift (−2px, border inkens, 150ms expo-out).
- `.plate-num` — typed catalog number. On covers it rides a paper chip
  (`.catalogue-plate-num`, paper-light 88% / ink) so it reads on any art.
- `.plate-title` — Newsreader small-caps label (book titles, beat titles).
- `.plate-meta` — 11px muted secondary line.
- `.catalog-rule` — double hairline rule for mastheads and section heads.
- `.ornament` — stamp-colored ✳/✦ separators, 12px. Ornaments separate; they
  are never live-status glyphs except the single narration-pulse.

## Surfaces & components

- `.stamp-btn` primary action; `.ink-btn` secondary; `.paper-field` inputs
  (the pill exception).
- Menus: `.dropdown-content` (globals.css) and `.settings-menu` — paper-light,
  1px ink/25 border, 2px corners, `--lift-shadow`. One recipe everywhere.
- Modals: `.plate-modal` — the ONLY dialog shell. Daisy `modal-box` is retired.
- Focus: ONE global rule in apothecary.css — `:focus-visible` = 2px stamp
  outline, offset 2px, every interactive element. No per-site rings.
- Spinners: colocated border-spinners per lane (`library-spinner`,
  `chrome-spinner`, settings recipe). Never daisy `loading-spinner`.
- Selection: stamp fill/check. Blue is not in the palette.
- Progress: `.progress-track` / `.progress-fill` (ink fill, 2px).

## Product-shaped surfaces (2026-09-14 decisions, `PRODUCT.md`)

- **Library = the catalogue.** Grid only: 10 plates/row ≥1280px, 8 at 1024px,
  6 below. Covers always crop (2:3, `object-fit: cover`) — uniform visual
  weight. Three-line specimen label under each plate (title / author ·
  progress / № + format). Masthead: Fraunces wordmark + typed "№ N volumes ·
  date" + `.catalog-rule`. No view menu, no list mode, no group-by, no
  sort-by, no recent shelf (upstream machinery stays dormant in tree).
- **Integrations = AI only.** The panel hosts exactly The Prof — AI tutor
  endpoint and ElevenLabs voice. All sync/cloud/share rows removed.
- Onboarding, reader chrome, narration bar, and the Prof speak the same
  plate grammar.

## Hard rules

1. **No daisyUI tokens** (`btn-*`, `badge-*`, `card`, `bg-base-*`,
   `border-base-*`, `rounded-box`, `loading`, `modal-box`, `hero`) in any
   Palimpsest surface. (At 2026-09-14 the shipped lanes are clean; upstream
   remnants elsewhere are the backlog.)
2. Stamp is the only UI accent. Success may use cloth-moss sparingly.
   Nothing else — no blues, no `#F44336`, no non-palette grays.
3. Corners ≤ 2px, except `.paper-field` pills and genuinely circular icon
   buttons. No `shadow-*` utilities — `--lift-shadow` via the lane classes.
4. Disabled: 40% ink, no hover inversion.
5. Dark (`apothecary-dark`) and eink must survive every change — use the
   vars; no hardcoded light hexes outside `apothecary.css` token definitions
   (canvas code: documented token constants).
6. Contrast: body ≥ 4.5:1 on paper (`--muted` is the floor), large ≥ 3:1.
   Cover overlays must use the paper-chip pattern, never glow hacks.
7. Every user-facing string goes through `_()` and the librarian voice.
