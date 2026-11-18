# stratoscope

## 0.2.0

### Minor Changes

- 2c5ee97: `combineTopologies` puts several topologies into one, with edges between them, e.g. CI pipelines and the servers they deploy to. Profiles get `anchorLayers`, so every column of a combined topology keeps the anchor of its own domain in 3D and in the 2D views; topologies without it are laid out exactly as before.

## 0.1.1

### Patch Changes

- c41f173: `dist/diagram.js` and `dist/Diagram.js` no longer sit side by side: on case-insensitive file systems (macOS, Windows) one overwrote the other, and TypeScript projects with `forceConsistentCasingInFileNames` failed to compile. The component now lives in `Diagram2D.js`; imports stay the same.

## 0.1.0

### Minor Changes

- f92f41d: First release. stratoscope is the domain-neutral core that grew out of infra3d: connected data as stacked 3D layers (`Scene`) and 2D diagrams (`Diagram`, views `layers` and `columns`) for React, with dependency and impact highlighting, health analysis, SVG and draw.io export. Domain profiles (inline in the topology or by name) set shapes, colours, wording and how failures travel; without one, a neutral default applies. stratoscope-ci (formerly infra3d-import-ci) reads Woodpecker and Drone pipelines into such a topology.
