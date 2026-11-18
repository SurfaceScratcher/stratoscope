import type { DomainProfile } from 'stratoscope/core';

/**
 * CI pipelines (Woodpecker, Drone, …): a pipeline (Drone: build) consists of workflows (Drone:
 * stages, one per pipeline definition), a workflow of steps. Steps can produce results: images,
 * packages, releases, deploy targets.
 * Edges point from the dependent to what it needs, so "what fails with this step" is the impact
 * view and "why did this pipeline fail" the dependency view. `buildTopology` writes it into the
 * topology, so stratoscope picks it up by itself.
 */
export const CI_PROFILE: DomainProfile = {
  id: 'ci',
  label: 'CI pipelines',
  // Steps are the most numerous; grouped by workflow they form the grid the rest follows
  anchorLayer: 'step',
  // One workflow per group: side by side, so the workflows above them line up across
  anchorGroups: 'columns',
  nodeTypes: {
    pipeline: { label: 'Pipeline', shape: 'wide', emphasis: true, color: '#f7bc94' },
    workflow: { label: 'Workflow', shape: 'hexagon', color: '#cbb6f3' },
    step: { label: 'Step', shape: 'diamond', labelOnHover: true, color: '#97d7df' },
    // Results: what the steps produce and where they deliver to
    image: { label: 'Image', shape: 'cylinder', color: '#9fd3a8' },
    package: { label: 'Package', shape: 'box', color: '#e6d48f' },
    release: { label: 'Release', shape: 'slab', color: '#e6d48f' },
    deploy: { label: 'Deploy target', shape: 'ring', emphasis: true, color: '#f29b9b' },
    artifact: { label: 'Artifact', shape: 'box', color: '#c9c9c9' },
  },
  roles: {
    // Services (databases, caches) run next to the steps; clones fetch the code first
    service: { shape: 'cylinder' },
    clone: { shape: 'slab' },
  },
  edgeKinds: {
    contains: { label: ['consists of', 'part of'], structural: true, pull: 1, color: '#a7a4bb' },
    // The workflow's box around its steps already shows this
    runs: { label: ['runs', 'step of'], structural: true, pull: 1, impliedByColumn: true, color: '#a7a4bb' },
    // No pull: a workflow stays above its own steps instead of drifting towards the ones it needs
    needs: { label: ['needs', 'needed by'], structural: true, color: '#cbb6f3' },
    // Steps without `depends_on` run one after another
    after: { label: ['runs after', 'runs before'], line: 'dashed', structural: true, pull: 0.5, color: '#97d7df' },
    uses: { label: ['uses service', 'serves'], line: 'dashed', faint: true, pull: 0.3, color: '#f2b3d9' },
    // From the result to the step: a failed step leaves its image or target outdated
    builds: { label: ['built by', 'builds'], structural: true, pull: 0.5, color: '#9fd3a8' },
    deploys: { label: ['delivered by', 'delivers to'], structural: true, pull: 0.5, color: '#f29b9b' },
  },
  defaultShape: 'box',
};

