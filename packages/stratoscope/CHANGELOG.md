# stratoscope

## 0.1.0

### Minor Changes

- f92f41d: First release. stratoscope is the domain-neutral core that grew out of infra3d: connected data as stacked 3D layers (`Scene`) and 2D diagrams (`Diagram`, views `layers` and `columns`) for React, with dependency and impact highlighting, health analysis, SVG and draw.io export. Domain profiles (inline in the topology or by name) set shapes, colours, wording and how failures travel; without one, a neutral default applies. stratoscope-ci (formerly infra3d-import-ci) reads Woodpecker and Drone pipelines into such a topology.
