import type { DomainProfile } from './profile.js';

/** Kind of node, e.g. `host` or `pipeline`. Its look comes from the domain profile. */
export type NodeType = string;

/**
 * Kind of edge, e.g. `runs-on` or `needs`. Edges always point from the dependent to what it
 * depends on ("step needs step", "container runs on host"); the profile says how failures travel.
 */
export type EdgeKind = string;

export interface GraphLayer {
  id: string;
  label: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  layer: string;
  /** Layout column, e.g. a host or a repository. */
  column?: string;
  /** Group within the column, e.g. a compose stack or a CI workflow. */
  group?: string;
  /** Free-form role; the profile can give roles their own shape. */
  role?: string;
  /** Probe target for health checks, e.g. `https://app.example.com` or `tcp://10.0.0.5:22`. */
  check?: string;
  /** State reported by the source, e.g. a failed CI step. Live health checks take precedence. */
  status?: NodeStatus;
  /** Offset [x, z] relative to the computed position. */
  offset?: [number, number];
  meta?: Record<string, string | number>;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

/** Version of the topology format described by topology.schema.json. */
export const SCHEMA_VERSION = 1;

/** Connected data as stacked layers. */
export interface Topology {
  $schema?: string;
  schemaVersion?: typeof SCHEMA_VERSION;
  name?: string;
  /**
   * Domain of the data: the name of a known profile or a whole profile. It decides shapes,
   * colours, wording and how failures travel. Default: DEFAULT_PROFILE (neutral).
   */
  profile?: string | DomainProfile;
  /** Bottom to top. */
  layers: GraphLayer[];
  columns?: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type HighlightMode = 'deps' | 'impact' | 'both';

/** Live state of a node, e.g. derived from health checks or reported by the source. */
export type NodeStatus = 'ok' | 'down' | 'suspect' | 'unknown';
