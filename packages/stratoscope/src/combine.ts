import { anchorLayerOf, resolveProfile, type DomainProfile, type EdgeKindSpec, type NodeTypeSpec } from './profile.js';
import { SCHEMA_VERSION, type GraphEdge, type GraphLayer, type Topology } from './types.js';

export interface CombineOptions {
  name?: string;
  /** Edges between the parts, e.g. from a container to the CI image it runs. */
  edges?: GraphEdge[];
  /** Kinds of those edges; they win over kinds of the same name in the parts. */
  edgeKinds?: Record<string, EdgeKindSpec>;
  /** Extra node types, e.g. for nodes a link adds. */
  nodeTypes?: Record<string, NodeTypeSpec>;
  /** Layer ids bottom to top. Default: the parts' layers in the order of the parts. */
  layers?: string[];
  /** Profiles of parts that only name theirs (`"profile": "infra"`). */
  profiles?: Record<string, DomainProfile>;
  /** Profile of parts without any. Default DEFAULT_PROFILE. */
  fallback?: DomainProfile;
}

/**
 * One topology from several, e.g. CI pipelines and the infrastructure they deploy to.
 *
 * - The profile is the union of the parts' profiles: node types, roles and edge kinds of earlier
 *   parts win when names clash. Each part keeps its own anchor: the first part's is `anchorLayer`,
 *   the others' are `anchorLayers`, so every column is laid out by its own domain's rules.
 * - Layers, columns, nodes and edges are concatenated. A node id that occurs in several parts is
 *   kept once, from the first part, so parts can share nodes on purpose.
 * - `edges` link the parts; edges whose ends are missing are dropped.
 */
export function combineTopologies(parts: Topology[], opts: CombineOptions = {}): Topology {
  const profiles = parts.map((t) => resolveProfile(t, opts.profiles, opts.fallback));
  const first = profiles[0];
  const union = <T>(pick: (p: DomainProfile) => Record<string, T> | undefined) =>
    Object.assign({}, ...[...profiles].reverse().map((p) => pick(p) ?? {})) as Record<string, T>;

  const anchors = [...new Set(parts.map((t, i) => anchorLayerOf(profiles[i], t)))];
  const profile: DomainProfile = {
    id: [...new Set(profiles.map((p) => p.id))].join('+'),
    label: [...new Set(profiles.map((p) => p.label))].join(' + '),
    anchorLayer: anchors[0],
    ...(anchors.length > 1 && { anchorLayers: anchors.slice(1) }),
    ...(first?.anchorGroups && { anchorGroups: first.anchorGroups }),
    nodeTypes: { ...union((p) => p.nodeTypes), ...opts.nodeTypes },
    roles: union((p) => p.roles),
    edgeKinds: { ...union((p) => p.edgeKinds), ...opts.edgeKinds },
    ...(first?.defaultShape && { defaultShape: first.defaultShape }),
    ...(first?.looseColumn && { looseColumn: first.looseColumn }),
  };

  const layerById = new Map<string, GraphLayer>();
  for (const t of parts) for (const l of t.layers) if (!layerById.has(l.id)) layerById.set(l.id, l);
  const layers = opts.layers
    ? [...opts.layers.map((id) => layerById.get(id)).filter((l): l is GraphLayer => !!l), ...[...layerById.values()].filter((l) => !opts.layers!.includes(l.id))]
    : [...layerById.values()];

  const nodes = new Map<string, Topology['nodes'][number]>();
  for (const t of parts) for (const n of t.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const columns = [...new Set(parts.flatMap((t) => t.columns ?? [...new Set(t.nodes.map((n) => n.column).filter((c): c is string => !!c))]))];
  const links = (opts.edges ?? []).filter((e) => nodes.has(e.from) && nodes.has(e.to));

  return {
    schemaVersion: SCHEMA_VERSION,
    name: opts.name ?? parts.map((t) => t.name).filter(Boolean).join(' + '),
    profile,
    layers,
    columns,
    nodes: [...nodes.values()],
    edges: [...parts.flatMap((t) => t.edges), ...links],
  };
}
