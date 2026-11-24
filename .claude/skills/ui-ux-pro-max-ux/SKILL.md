---
name: ui-ux-pro-max-ux
description: "UX-only rule set (accessibility, touch & interaction, performance, layout & responsive, forms & feedback, navigation) extracted from ui-ux-pro-max. Use whenever building, redesigning, reviewing, or fixing a web page, landing page, or app UI — alongside the taste skills (design-taste-frontend, redesign-existing-projects) — to check how the page is operated by keyboard/touch, read by screen readers, and behaves across viewports. Visual style, color, typography and motion are out of scope; those belong to the taste skills."
---

# UI/UX Pro Max — UX subset

A trimmed copy of [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT, commit d14efff) that keeps only the UX guidance not already covered by the taste skills.

## Scope

| In scope (this skill) | Out of scope (use taste) |
|---|---|
| Accessibility (contrast check, focus, ARIA, keyboard, skip links, headings, reduced-motion *compliance*) | Style selection, aesthetic direction |
| Touch & interaction (target size, spacing, hover-vs-tap, feedback) | Color palettes, color tokens |
| Performance (CLS, font loading, lazy loading, main-thread budget) | Typography, font pairing |
| Layout & responsive (viewport, horizontal scroll, fixed-element offset, z-index scale) | Motion choreography, GSAP presets |
| Forms & feedback (labels, errors, live regions) | Landing structure, design systems |
| Navigation (active state, deep links, focus not obscured) | Charts (use `dataviz`) |

Removed from the upstream copy: `styles/colors/typography/google-fonts/landing/products/motion/icons/charts` data, the search scripts, quick-reference §4/§6/§7/§10, and the `Typography` / `Animation` rows of `ux-guidelines.csv`.

## Files

All paths are relative to this skill's directory (`~/.claude/skills/ui-ux-pro-max-ux/`), not the project.

- `references/ux-quick-reference.md` — one-line index of every rule, grouped by category (§1, 2, 3, 5, 8, 9). Read this first for an audit pass.
- `data/ux-guidelines.csv` — 102 rules with Do / Don't / code examples / severity. Columns: `No,Category,Issue,Platform,Description,Do,Don't,Code Example Good,Code Example Bad,Severity`.

## How to look things up

No search script. Grep the CSV by keyword or category:

```bash
grep -i "focus" ~/.claude/skills/ui-ux-pro-max-ux/data/ux-guidelines.csv
grep -i ",Accessibility," ~/.claude/skills/ui-ux-pro-max-ux/data/ux-guidelines.csv
grep -i ",High$" ~/.claude/skills/ui-ux-pro-max-ux/data/ux-guidelines.csv   # severity filter
```

## Audit workflow

1. Read `references/ux-quick-reference.md` and walk the page category by category in priority order: Accessibility → Touch & Interaction → Layout & Responsive → Navigation → Performance → Forms & Feedback.
2. For each suspected issue, grep the CSV for the rule's Do / Don't and code example before fixing.
3. Record each finding as: rule id, location, observed problem, fix.
4. Do not change visual style, palette, type or motion feel to satisfy a UX rule unless the rule demands it (e.g. contrast below 4.5:1); hand visual decisions to the taste skill.
5. Verify in a real browser: keyboard tab-through, 375px width with no horizontal scroll, `prefers-reduced-motion: reduce`, console clean.
