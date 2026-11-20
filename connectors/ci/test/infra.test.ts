import { describe, expect, it } from 'vitest';
import { traverse, validateTopology, type DomainProfile, type Topology } from 'stratoscope/core';
import { buildTopology, canonicalImage, combineWithInfra, imageName, linkToInfra, type CiSnapshot } from '../src/index.js';

const INFRA: DomainProfile = {
  id: 'infra',
  label: 'Infrastructure',
  anchorLayer: 'container',
  nodeTypes: { host: { label: 'Host' }, container: { label: 'Container' }, endpoint: { label: 'Endpoint' } },
  edgeKinds: { 'runs-on': { pull: 1 }, routes: { pull: 1 } },
};

// As stratoscope-compose writes it: host as column, stack as group, the image in meta
const infra: Topology = {
  name: 'Servers',
  layers: [{ id: 'physical', label: 'Hosts' }, { id: 'container', label: 'Containers' }, { id: 'endpoint', label: 'Endpoints' }],
  nodes: [
    { id: 'h:prod', label: 'prod', type: 'host', layer: 'physical', column: 'prod' },
    { id: 'c:prod:shop:api', label: 'api', type: 'container', layer: 'container', column: 'prod', group: 'shop', meta: { Image: 'registry.example.com/acme/shop-api:${API_TAG:-latest}' } },
    { id: 'c:prod:shop:db', label: 'db', type: 'container', layer: 'container', column: 'prod', group: 'shop', meta: { Image: 'postgres:17' } },
    { id: 'c:prod:wiki:app', label: 'app', type: 'container', layer: 'container', column: 'prod', group: 'wiki', meta: { Image: 'docker.io/library/nginx:1' } },
    { id: 'e:shop', label: 'shop.example.com', type: 'endpoint', layer: 'endpoint', column: 'prod' },
  ],
  edges: [
    { from: 'c:prod:shop:api', to: 'h:prod', kind: 'runs-on' },
    { from: 'e:shop', to: 'c:prod:shop:api', kind: 'routes' },
  ],
};

const snapshot: CiSnapshot = {
  source: 'drone',
  repos: [{
    repo: { slug: 'acme/shop' },
    pipelines: [{
      number: 7,
      state: 'failure',
      workflows: [{
        name: 'publish',
        state: 'failure',
        steps: [
          { name: 'docker', state: 'failure', kind: 'step', outputs: [{ kind: 'image', target: 'registry.example.com/acme/shop-api', via: 'plugins/docker' }] },
          { name: 'deploy', state: 'skipped', kind: 'step', outputs: [{ kind: 'deploy', target: '<deploy-host>:/srv/stacks/prod/shop', via: 'appleboy/drone-ssh' }] },
          { name: 'mirror', state: 'success', kind: 'step', outputs: [{ kind: 'image', target: 'nginx', via: 'commands' }] },
        ],
      }],
    }],
  }],
};
const ci = buildTopology(snapshot);

describe('linkToInfra', () => {
  it('links containers to the CI image they run, whatever the tag, and stacks to their deploy target', () => {
    expect(linkToInfra(ci, infra)).toEqual([
      { from: 'c:prod:shop:api', to: 'o:image:registry.example.com/acme/shop-api', kind: 'runs-image' },
      { from: 'c:prod:shop:api', to: 'o:deploy:<deploy-host>:/srv/stacks/prod/shop', kind: 'deployed-by' },
      { from: 'c:prod:shop:db', to: 'o:deploy:<deploy-host>:/srv/stacks/prod/shop', kind: 'deployed-by' },
      // Docker Hub's implicit prefixes do not stand in the way
      { from: 'c:prod:wiki:app', to: 'o:image:nginx', kind: 'runs-image' },
    ]);
  });

  it('matches a deploy target by its host as well', () => {
    const byHost = buildTopology({ ...snapshot, repos: [{ ...snapshot.repos[0], pipelines: [{ ...snapshot.repos[0].pipelines[0], workflows: [{ name: 'd', state: 'success', steps: [{ name: 's', state: 'success', kind: 'step', outputs: [{ kind: 'deploy', target: 'prod:/opt/wiki' }] }] }] }] }] });
    expect(linkToInfra(byHost, infra).map((e) => e.from)).toEqual(['c:prod:wiki:app']);
  });

  it('normalizes image references', () => {
    expect(imageName('app:${TAG:-latest}')).toBe('app');
    expect(imageName('docker.io/library/nginx:1')).toBe('nginx');
    expect(imageName('localhost:5000/team/app:${T}')).toBe('localhost:5000/team/app');
  });
});

describe('registry aliases', () => {
  // The CI pushes to the registry on the build host, the servers pull it under its network name
  const local = buildTopology({ source: 'woodpecker', repos: [{ repo: { slug: 'team/app' }, pipelines: [{ number: 3, state: 'success', workflows: [{ name: 'build', state: 'success', steps: [{ name: 'image', state: 'success', kind: 'step', outputs: [{ kind: 'image', target: 'localhost:5000/team/app' }] }] }] }] }] });
  const servers: Topology = {
    name: 'Servers',
    layers: [{ id: 'container', label: 'Containers' }],
    nodes: [{ id: 'c:app', label: 'app', type: 'container', layer: 'container', column: 'prod', meta: { Image: 'registry.example.internal:5000/team/app:prod-123' } }],
    edges: [],
  };
  const aliases = { 'localhost:5000': 'registry.example.internal:5000' };

  it('matches images across names of the same registry', () => {
    expect(linkToInfra(local, servers)).toEqual([]);
    expect(linkToInfra(local, servers, { registryAliases: aliases })).toEqual([{ from: 'c:app', to: 'o:image:localhost:5000/team/app', kind: 'runs-image' }]);
    const both = combineWithInfra(local, servers, { registryAliases: aliases });
    expect(both.edges.filter((e) => e.kind === 'runs-image')).toHaveLength(1);
    // Only for matching: the image keeps its name
    expect(both.nodes.find((n) => n.type === 'image')).toMatchObject({ label: 'team/app', meta: { Target: 'localhost:5000/team/app' } });
    expect(both.profile).not.toHaveProperty('registryAliases');
  });

  it('maps whole registry names only', () => {
    expect(canonicalImage('LOCALHOST:5000/a/b:1', { 'https://localhost:5000/': 'reg:5000' })).toBe('reg:5000/a/b');
    expect(canonicalImage('localhost:50001/a/b', aliases)).toBe('localhost:50001/a/b');
    expect(canonicalImage('nginx:1', aliases)).toBe('nginx');
  });
});

describe('combineWithInfra', () => {
  const t = combineWithInfra(ci, infra, { fallback: INFRA });

  it('puts the CI under the infrastructure, results right below the hosts', () => {
    expect(validateTopology(t)).toMatchObject({ errors: [], warnings: [] });
    expect(t.layers.map((l) => l.id)).toEqual(['step', 'workflow', 'pipeline', 'output', 'physical', 'container', 'endpoint']);
    expect(t.profile).toMatchObject({ anchorLayer: 'container', anchorLayers: ['step'] });
  });

  it('shows which running containers a failed build leaves outdated, without calling them down', () => {
    const up = traverse(t, 's:acme/shop#7/publish/1', 'up');
    expect(up.nodes).toContain('c:prod:shop:api');
    // The endpoint in front of the container still works
    expect(up.nodes).not.toContain('e:shop');
  });
});
