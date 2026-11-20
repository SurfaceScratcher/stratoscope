import { combineTopologies, type CombineOptions, type EdgeKindSpec, type GraphEdge, type GraphNode, type Topology } from 'stratoscope/core';
import { LAYERS, OUTPUT_LAYER } from './build.js';
import { imageName } from './outputs.js';

/** Edges from the infrastructure to the CI results it runs. A failed build leaves a container outdated, not down. */
export const CI_INFRA_EDGE_KINDS: Record<string, EdgeKindSpec> = {
  'runs-image': { label: ['runs image', 'runs in'], line: 'dashed', propagates: false, color: '#9fd3a8' },
  'deployed-by': { label: ['deployed by', 'deploys'], line: 'dashed', propagates: false, color: '#f29b9b' },
};

/** Options of `linkToInfra`. */
export interface LinkOptions {
  /**
   * Registry names that stand for the same registry, mapped onto one of them: the CI pushes to
   * `localhost:5000`, the hosts pull from `registry.example.internal:5000`. Only for matching; the
   * image nodes keep their names.
   */
  registryAliases?: Record<string, string>;
}

/** The image name for matching: without tag, with an aliased registry replaced. */
export function canonicalImage(ref: string, aliases: Record<string, string> = {}): string {
  const name = imageName(ref);
  const slash = name.indexOf('/');
  if (slash < 0) return name;
  const registry = name.slice(0, slash).toLowerCase();
  const host = (r: string) => r.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  for (const [from, to] of Object.entries(aliases)) {
    if (registry === host(from).toLowerCase()) return `${host(to)}${name.slice(slash)}`;
  }
  return name;
}

const deployParts = (target: string) => {
  const i = target.search(/:\//);
  return i < 0 ? { host: target, path: [] as string[] } : { host: target.slice(0, i), path: target.slice(i + 1).split('/').filter(Boolean) };
};

/**
 * Edges from an infrastructure topology into a CI topology with results:
 * - `runs-image`: a node with `meta.Image` (a container) → the CI image of that name, tag ignored.
 * - `deployed-by`: a node with a `column` (host) and `group` (stack) → a CI deploy target whose
 *   path ends in the stack and names the host, either as the target's host or as a directory
 *   (`prod:/srv/shop`, `<secret>:/opt/stacks/hosts/prod/shop`).
 * `opts.registryAliases` lets images match across registry names of the same registry.
 * Follows the conventions of stratoscope-compose: containers carry `meta.Image`, their host as
 * column and their stack as group.
 */
export function linkToInfra(ci: Topology, infra: Topology, opts: LinkOptions = {}): GraphEdge[] {
  const canonical = (ref: string) => canonicalImage(ref, opts.registryAliases);
  const images = new Map<string, string>();
  const deploys: { id: string; host: string; path: string[] }[] = [];
  for (const n of ci.nodes) {
    if (n.type === 'image' && n.meta?.Target) images.set(canonical(String(n.meta.Target)), n.id);
    if (n.type === 'deploy' && n.meta?.Target) deploys.push({ id: n.id, ...deployParts(String(n.meta.Target)) });
  }
  const edges: GraphEdge[] = [];
  for (const n of infra.nodes) {
    const image = n.meta?.Image ? images.get(canonical(String(n.meta.Image))) : undefined;
    if (image) edges.push({ from: n.id, to: image, kind: 'runs-image' });
    for (const d of deploys) if (deployedTo(n, d)) edges.push({ from: n.id, to: d.id, kind: 'deployed-by' });
  }
  return edges;
}

function deployedTo(n: GraphNode, d: { host: string; path: string[] }): boolean {
  if (!n.column || !n.group || d.path.at(-1) !== n.group) return false;
  return d.host === n.column || d.path.slice(0, -1).includes(n.column);
}

/**
 * CI pipelines and the infrastructure they build for, as one topology: the CI layers at the bottom,
 * its results right under the hosts, linked by `linkToInfra`. Pass the infrastructure profile in
 * `opts.profiles` or `opts.fallback` if the infrastructure topology does not carry it.
 */
export function combineWithInfra(ci: Topology, infra: Topology, opts: CombineOptions & LinkOptions = {}): Topology {
  const { registryAliases, ...combine } = opts;
  const ciLayers = [...LAYERS, OUTPUT_LAYER].map((l) => l.id);
  return combineTopologies([infra, ci], {
    name: 'CI and infrastructure',
    layers: [...ciLayers, ...infra.layers.map((l) => l.id).filter((id) => !ciLayers.includes(id))],
    ...combine,
    edges: [...linkToInfra(ci, infra, { registryAliases }), ...(combine.edges ?? [])],
    edgeKinds: { ...CI_INFRA_EDGE_KINDS, ...combine.edgeKinds },
  });
}
