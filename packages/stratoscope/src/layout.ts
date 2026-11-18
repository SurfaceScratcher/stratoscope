import { columnAnchors, edgeKindSpec, resolveProfile, type DomainProfile } from './profile.js';
import type { GraphNode, Topology } from './types.js';

export type Vec3 = [number, number, number];

export interface LayoutOptions {
  /** Anchor layer and edge pulls come from here. Default: the topology's (`topology.profile`), else DEFAULT_PROFILE. */
  profile?: DomainProfile;
  /** Layer whose nodes are placed on a grid; all other layers follow from it. Default: the profile's, per column with `anchorLayers`. */
  anchorLayer?: string;
  /** Groups of the anchor layer one behind the other (`rows`) or side by side (`columns`). Default: the profile's, else `rows`. */
  anchorGroups?: 'rows' | 'columns';
  layerGap?: number;
  itemGap?: number;
  groupGap?: number;
  columnGap?: number;
  minDistance?: number;
}

export interface Layout {
  positions: Map<string, Vec3>;
  /** How the groups of the anchor layer were laid out. */
  anchorGroups: 'rows' | 'columns';
  layerY: Map<string, number>;
  /** `layer`: the column's anchor layer, where its outline is drawn. */
  columns: { id: string; x: number; z: number; width: number; depth: number; layer: string }[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function computeLayout(topo: Topology, opts: LayoutOptions = {}): Layout {
  const profile = opts.profile ?? resolveProfile(topo);
  const { anchorLayer, anchorGroups = profile.anchorGroups ?? 'rows', layerGap = 10, itemGap = 3.2, groupGap = 3.5, columnGap = 9, minDistance = 2.6 } = opts;

  const layerY = new Map(topo.layers.map((l, i) => [l.id, i * layerGap]));
  const positions = new Map<string, Vec3>();
  const columnIds = topo.columns ?? [...new Set(topo.nodes.map((n) => n.column).filter(Boolean) as string[])];

  // 1. Anchor layer: one grid per column, one row per group, or one column per group with `columns`
  //    (then the nodes above the groups line up across instead of in depth).
  const anchorOf = columnAnchors(profile, topo, anchorLayer);
  const isAnchor = (n: GraphNode) => n.layer === anchorOf(n.column);
  const anchors = topo.nodes.filter(isAnchor);
  // Side by side, the labels of the nodes above the groups need more room than a row does
  const spread = anchorGroups === 'columns' ? Math.max(groupGap, itemGap) * 1.6 : groupGap;
  const colGroups = columnIds.map((col) => {
    const groups = new Map<string, GraphNode[]>();
    for (const n of anchors.filter((a) => a.column === col)) {
      const g = n.group ?? '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(n);
    }
    const rows = [...groups.values()];
    const longest = Math.max(1, ...rows.map((r) => r.length)) * itemGap;
    const across = Math.max(1, rows.length) * spread;
    return anchorGroups === 'columns' ? { col, rows, width: across, depth: longest } : { col, rows, width: longest, depth: across };
  });

  const totalWidth = colGroups.reduce((s, c) => s + c.width, 0) + columnGap * (colGroups.length - 1);
  let cursor = -totalWidth / 2;
  const columns: Layout['columns'] = [];
  for (const c of colGroups) {
    const cx = cursor + c.width / 2;
    c.rows.forEach((row, ri) => {
      const across = (ri - (c.rows.length - 1) / 2) * spread;
      row.forEach((n, i) => {
        const along = (i - (row.length - 1) / 2) * itemGap;
        const [x, z] = anchorGroups === 'columns' ? [cx + across, along] : [cx + along, across];
        positions.set(n.id, [x, layerY.get(n.layer) ?? 0, z]);
      });
    });
    columns.push({ id: c.col, x: cx, z: 0, width: c.width, depth: c.depth, layer: anchorOf(c.col) });
    cursor += c.width + columnGap;
  }
  const columnX = new Map(columns.map((c) => [c.id, c.x]));

  // 2. Remaining nodes: weighted centroid of already placed neighbours,
  //    layers in order of their distance to the anchor layer.
  const adj = new Map<string, { id: string; w: number }[]>();
  for (const e of topo.edges) {
    const w = edgeKindSpec(profile, e.kind).pull ?? 0;
    if (!w) continue;
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a)!.push({ id: b, w });
    }
  }
  const layerIdx = (id: string) => topo.layers.findIndex((l) => l.id === id);
  // Distance to the anchor of the node's own column
  const distance = (n: GraphNode) => Math.abs(layerIdx(n.layer) - layerIdx(anchorOf(n.column)));
  const rest = topo.nodes
    .filter((n) => !positions.has(n.id))
    .sort((a, b) => distance(a) - distance(b));

  const place = (n: GraphNode, x: number, z: number) => {
    const [ox, oz] = n.offset ?? [0, 0];
    positions.set(n.id, [x + ox, layerY.get(n.layer) ?? 0, z + oz]);
  };

  let unplaced = rest;
  for (let pass = 0; pass < 6 && unplaced.length; pass++) {
    const next: GraphNode[] = [];
    for (const n of unplaced) {
      let sx = 0, sz = 0, sw = 0;
      for (const { id, w } of adj.get(n.id) ?? []) {
        const p = positions.get(id);
        if (!p) continue;
        sx += p[0] * w;
        sz += p[2] * w;
        sw += w;
      }
      if (sw > 0) place(n, sx / sw, sz / sw);
      else next.push(n);
    }
    unplaced = next;
  }
  for (const n of unplaced) place(n, n.column ? columnX.get(n.column) ?? 0 : 0, 0);

  // 3. Push apart overlapping nodes within a layer (the anchor layer stays fixed).
  const byLayer = new Map<string, GraphNode[]>();
  for (const n of topo.nodes) {
    if (isAnchor(n)) continue;
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  for (const list of byLayer.values()) {
    for (let iter = 0; iter < 40; iter++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = positions.get(list[i].id)!;
          const b = positions.get(list[j].id)!;
          let dx = b[0] - a[0];
          let dz = b[2] - a[2];
          let d = Math.hypot(dx, dz);
          if (d >= minDistance) continue;
          if (d < 1e-3) { dx = 1; dz = 0.3; d = Math.hypot(dx, dz); }
          const push = (minDistance - d) / 2;
          a[0] -= (dx / d) * push; a[2] -= (dz / d) * push;
          b[0] += (dx / d) * push; b[2] += (dz / d) * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, , z] of positions.values()) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { positions, anchorGroups, layerY, columns, bounds: { minX, maxX, minZ, maxZ } };
}
