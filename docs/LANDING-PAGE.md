# Landing Page Concepts

This document describes the landing experience shown before the map explorer UI.

## Overview

The client now opens with a concept switcher that previews four landing directions:

- **Roots & Rhythm**
- **Sunrise Escape**
- **Out of Many**
- **Business**

Selecting **Enter** moves into the main explorer (`MapSection` + `InfoSection`) without changing backend/API behavior.

## Implementation

- Main gate: `client/src/App.jsx`
  - `showExplorer` controls whether the landing screen or map explorer is shown.
  - `landingVariant` controls which concept is active.
- Landing component: `client/src/components/LandingShowcase.jsx`
  - Renders concept-specific copy and visual treatment.
- Styles: `client/src/App.css`
  - Shared landing styles plus variant-specific classes:
    - `.landing-roots`
    - `.landing-sunrise`
    - `.landing-unity`
    - `.landing-business`

## Roots & Rhythm design notes

The Roots concept uses a faded Jamaican-flag inspired background and a circular image collage.

### Image assets

Assets are served from `client/public/landing/`:

- `roots-rasta.png`
- `roots-smoke.png`
- `roots-crew.png`
- `roots-art-profile.png`
- `roots-emancipation.png`
- `roots-flag-leaves.png`
- `roots-waterfall.png`

### Layout behavior

- Circular collage is rendered in `.roots-circle-layout`.
- Image nodes are positioned with `.roots-img-*` classes in `App.css`.
- Headline/subhead/CTA remain standard landing content flow below the collage.

## Business concept notes

The Business concept focuses on:

- Corporate presentation tone
- Technology and infrastructure framing
- Land, ports, airports, and growth corridors

It uses a dedicated background class: `.landing-business::before`.

## Notes for future edits

- Keep image references under `/landing/...` so Vite serves them from `public/`.
- If adding another concept, update:
  - `landingVariants` array in `LandingShowcase.jsx`
  - concept picker styles in `App.css`
  - this document and `docs/LANDING-PAGE-DIAGRAM.md`
