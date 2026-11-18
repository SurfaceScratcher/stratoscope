import { describe, expect, it } from 'vitest';
import { combineTopologies, columnAnchors, computeDiagramLayout, computeLayout, traverse, validateTopology, type DomainProfile, type Topology } from '../src/core.js';

const HOSTS: DomainProfile = {
  id: 'hosts',
  label: 'Hosts',
  anchorLayer: 'app',
  nodeTypes: { host: { label: 'Host', shape: 'wide' }, app: { label: 'App' } },
  edgeKinds: { 'runs-on': { label: ['runs on', 'runs'], pull: 1 }, uses: { label: ['uses', 'used by'], color: '#111111' } },
};
const BUILDS: DomainProfile = {
  id: 'builds',
  label: 'Builds',
  anchorLayer: 'job',
  anchorGroups: 'columns',
  nodeTypes: { job: { label: 'Job' }, image: { label: 'Image', shape: 'cylinder' } },
  edgeKinds: { builds: { label: ['built by', 'builds'], pull: 1 }, uses: { label: ['uses service', 'serves'], color: '#222222' } },
};

const hosts: Topology = {
  name: 'Hosts',
  profile: HOSTS,
  layers: [{ id: 'host', label: 'Hosts' }, { id: 'app', label: 'Apps' }],
  columns: ['h1'],
  nodes: [
    { id: 'h1', label: 'h1', type: 'host', layer: 'host', column: 'h1' },
    { id: 'a1', label: 'shop', type: 'app', layer: 'app', column: 'h1', group: 'shop' },
    { id: 'a2', label: 'db', type: 'app', layer: 'app', column: 'h1', group: 'shop' },
  ],
  edges: [{ from: 'a1', to: 'h1', kind: 'runs-on' }, { from: 'a2', to: 'h1', kind: 'runs-on' }, { from: 'a1', to: 'a2', kind: 'uses' }],
};
const builds: Topology = {
  name: 'Builds',
  profile: BUILDS,
  layers: [{ id: 'job', label: 'Jobs' }, { id: 'image', label: 'Images' }],
  columns: ['repo'],
  nodes: [
    { id: 'j1', label: 'test', type: 'job', layer: 'job', column: 'repo', group: 'ci' },
    { id: 'j2', label: 'push', type: 'job', layer: 'job', column: 'repo', group: 'ci', status: 'down' },
    { id: 'i1', label: 'shop', type: 'image', layer: 'image', column: 'repo' },
  ],
  edges: [{ from: 'j2', to: 'j1', kind: 'uses' }, { from: 'i1', to: 'j2', kind: 'builds' }],
};

describe('combineTopologies', () => {
  const t = combineTopologies([hosts, builds], {
    edges: [{ from: 'a1', to: 'i1', kind: 'runs-image' }, { from: 'a1', to: 'missing', kind: 'runs-image' }],
    edgeKinds: { 'runs-image': { label: ['runs image', 'runs in'], propagates: false } },
    layers: ['job', 'image', 'host', 'app'],
  });
  const profile = t.profile as DomainProfile;

  it('is a valid topology with the parts in it and the links between them', () => {
    expect(validateTopology(t)).toMatchObject({ errors: [], warnings: [] });
    expect(t.nodes).toHaveLength(6);
    expect(t.columns).toEqual(['h1', 'repo']);
    expect(t.layers.map((l) => l.id)).toEqual(['job', 'image', 'host', 'app']);
    expect(t.edges.filter((e) => e.kind === 'runs-image')).toEqual([{ from: 'a1', to: 'i1', kind: 'runs-image' }]);
    expect(t.name).toBe('Hosts + Builds');
  });

  it('unites the profiles; on a name clash the earlier part wins', () => {
    expect(profile).toMatchObject({ id: 'hosts+builds', label: 'Hosts + Builds', anchorLayer: 'app', anchorLayers: ['job'] });
    expect(Object.keys(profile.nodeTypes)).toEqual(expect.arrayContaining(['host', 'app', 'job', 'image']));
    expect(profile.edgeKinds.uses.color).toBe('#111111');
    expect(profile.edgeKinds['runs-image'].propagates).toBe(false);
  });

  it('anchors every column on the anchor of its own domain', () => {
    const anchorOf = columnAnchors(profile, t);
    expect([anchorOf('h1'), anchorOf('repo'), anchorOf('nowhere')]).toEqual(['app', 'job', 'app']);
    const layout = computeLayout(t);
    expect(layout.columns.map((c) => [c.id, c.layer])).toEqual([['h1', 'app'], ['repo', 'job']]);
    // Both jobs sit on the grid of their column instead of collapsing onto one point
    const [j1, j2] = ['j1', 'j2'].map((id) => layout.positions.get(id)!);
    expect(Math.hypot(j1[0] - j2[0], j1[2] - j2[2])).toBeGreaterThan(2);
    // The columns view boxes the groups of each column's anchor layer
    const diagram = computeDiagramLayout(t, { view: 'columns' });
    expect(diagram.groups.map((g) => g.label).sort()).toEqual(['ci', 'shop']);
  });

  it('follows a failure across the link only as far as the link allows', () => {
    const up = traverse(t, 'j2', 'up');
    // The app runs the image the failed job built, but the app's own dependants are not affected
    expect([...up.nodes].sort()).toEqual(['a1', 'i1', 'j2']);
  });

  it('keeps a node that several parts contain once, from the first part', () => {
    const shared = combineTopologies([hosts, { ...builds, nodes: [...builds.nodes, { id: 'h1', label: 'other', type: 'host', layer: 'host' }] }]);
    expect(shared.nodes.filter((n) => n.id === 'h1')).toEqual([hosts.nodes[0]]);
  });

  it('takes the profile of a part that only names it from `profiles`', () => {
    const named = combineTopologies([{ ...hosts, profile: 'hosts' }, builds], { profiles: { hosts: HOSTS } });
    expect((named.profile as DomainProfile).anchorLayer).toBe('app');
  });
});

describe('validateTopology: anchorLayers', () => {
  it('checks the further anchor layers', () => {
    const t = { ...hosts, profile: { ...HOSTS, anchorLayers: ['nope'] } };
    expect(validateTopology(t).warnings).toContain('profile: anchorLayers "nope" is not a layer of this topology');
    expect(validateTopology({ ...hosts, profile: { ...HOSTS, anchorLayers: 'app' } }).errors).toContain('profile: "anchorLayers" must be a list of layer ids');
  });
});
