# Dark hero + footer sections on landing page

Changed the hero section (section before the sticky split layout) and the footer section (panel 7) to dark backgrounds (`#111`) on `SplitLanding.jsx`.

## What changed

### Hero section
- Background: `#111`
- Text: headings `#fff`, subtitle `#bbb`, muted labels `#999`
- Example cards: dark `#1e1e1e` bg with `#333` borders
- Added `spl-hero` class for scoped hover overrides in CSS

### Footer section (panel 7 — "Live agent session")
- Background: `#111`
- All text light variants
- Terminal box: dark shell (`#1a1a1a`/`#151515`)
- `Terminal` component accepts `dark` prop for light text/cursor colors

### CSS
- Added `.spl-hero .spl-card:hover` in `landing.css` so dark-hero cards darken to `#2a2a2a` on hover

## Files touched
- `src/components/landing/SplitLanding.jsx`
- `src/styles/landing.css`

## What was explicitly left alone
- All other panels remain light (alternating `bg`/`bg2`)
- The `PromptBox` component keeps its light background (card-on-dark contrast in hero, blends into sidebar)