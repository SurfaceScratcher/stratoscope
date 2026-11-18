# stratoscope-ci

## 0.3.0

### Minor Changes

- 2c5ee97: `combineWithInfra` and `linkToInfra` connect CI results with a stratoscope-infra topology: containers run the images a pipeline builds (`runs-image`), stacks live where it deploys to (`deployed-by`). Image names now ignore tags from variables (`app:${TAG:-latest}`) and Docker Hub's implicit prefixes.

### Patch Changes

- Updated dependencies [2c5ee97]
  - stratoscope@0.2.0

## 0.2.0

### Minor Changes

- 0ab2323: Show what pipelines produce: container images, packages, releases and deploy targets, read from the pipeline config (Woodpecker's API, or `--config` for Drone), on a new Results layer linked to the steps that build or deliver them.

## 0.1.0

### Minor Changes

- f92f41d: First release. stratoscope is the domain-neutral core that grew out of infra3d: connected data as stacked 3D layers (`Scene`) and 2D diagrams (`Diagram`, views `layers` and `columns`) for React, with dependency and impact highlighting, health analysis, SVG and draw.io export. Domain profiles (inline in the topology or by name) set shapes, colours, wording and how failures travel; without one, a neutral default applies. stratoscope-ci (formerly infra3d-import-ci) reads Woodpecker and Drone pipelines into such a topology.

### Patch Changes

- Updated dependencies [f92f41d]
  - stratoscope@0.1.0
