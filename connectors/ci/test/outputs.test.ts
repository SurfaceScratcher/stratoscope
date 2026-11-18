import { describe, expect, it } from 'vitest';
import { validateTopology } from 'stratoscope/core';
import { attachOutputs, buildTopology, outputLabel, detectOutputs, fromDrone, imageName, parseConfig, woodpecker, workflowNameOf, type CiSnapshot, type DroneBuild } from '../src/index.js';
import droneApi from './fixtures/drone.json' with { type: 'json' };
import woodpeckerApi from './fixtures/woodpecker.json' with { type: 'json' };
import { woodpeckerSnapshot } from './fixtures.js';

const DRONE_YML = `
kind: pipeline
type: docker
name: build
steps:
  - name: compile
    image: node:24
    commands:
      - npm ci && npm run build
---
kind: pipeline
name: deploy
steps:
  - name: release
    image: plugins/docker
    settings:
      registry: registry.example.com
      repo: registry.example.com/acme/shop
      tags: [latest, "\${DRONE_COMMIT_SHA:0:7}"]
      password: { from_secret: registry-password }
  - name: upload
    image: appleboy/drone-scp
    settings:
      host: { from_secret: deploy-host }
      target: /srv/stack/shop
  - name: restart
    image: appleboy/drone-ssh
    settings:
      host: { from_secret: deploy-host }
      script:
        - cd /srv/stack/shop
        - docker compose up -d
---
kind: secret
name: registry-password
`;

const WOODPECKER_DEPLOY = `
steps:
  clone-extra:
    image: alpine
    commands: [echo hi]
  release:
    image: woodpeckerci/plugin-docker-buildx:5
    settings:
      repo: acme/shop
      registry: registry.example.com
      tags: latest,1.2
`;

describe('parseConfig', () => {
  it('reads Drone documents as workflows and skips secrets', () => {
    const workflows = parseConfig({ name: '.drone.yml', data: DRONE_YML });
    expect(workflows.map((w) => w.name)).toEqual(['build', 'deploy']);
    expect(workflows[1].steps.map((s) => s.name)).toEqual(['release', 'upload', 'restart']);
    expect(workflows[0].steps[0].commands).toEqual(['npm ci && npm run build']);
  });

  it('names a Woodpecker workflow after its file and accepts steps as a map', () => {
    expect(workflowNameOf('.woodpecker/deploy.yaml')).toBe('deploy');
    expect(workflowNameOf('.woodpecker.yml')).toBe('woodpecker');
    const [w] = parseConfig({ name: '.woodpecker/deploy.yaml', data: WOODPECKER_DEPLOY });
    expect(w).toMatchObject({ name: 'deploy', steps: [{ name: 'clone-extra' }, { name: 'release', image: 'woodpeckerci/plugin-docker-buildx:5' }] });
  });

  it('yields nothing for broken YAML instead of failing', () => {
    expect(parseConfig({ data: 'steps: [unclosed' })).toEqual([]);
  });
});

describe('detectOutputs', () => {
  const [, deploy] = parseConfig({ data: DRONE_YML });
  const step = (name: string) => deploy.steps.find((s) => s.name === name)!;

  it('finds images from Docker plugins, with tags and the registry', () => {
    expect(detectOutputs(step('release'))).toEqual([
      { kind: 'image', target: 'registry.example.com/acme/shop', tags: ['latest', '${DRONE_COMMIT_SHA:0:7}'], via: 'plugins/docker' },
    ]);
    const [, release] = parseConfig({ name: '.woodpecker/deploy.yaml', data: WOODPECKER_DEPLOY })[0].steps;
    expect(detectOutputs(release)).toEqual([{ kind: 'image', target: 'registry.example.com/acme/shop', tags: ['latest', '1.2'], via: 'woodpeckerci/plugin-docker-buildx' }]);
  });

  it('turns copies and SSH scripts into deploy targets; secrets stay names unless the rules know them', () => {
    // Labels name the directory while the host is an unresolved secret
    expect(outputLabel({ kind: 'deploy', target: '<deploy-host>:/srv/stack/shop' }, 'acme/shop')).toBe('…/stack/shop');
    expect(outputLabel({ kind: 'deploy', target: 'prod:/srv/stack/shop' }, 'acme/shop')).toBe('prod:…/stack/shop');
    expect(detectOutputs(step('upload'))).toEqual([{ kind: 'deploy', target: '<deploy-host>:/srv/stack/shop', via: 'appleboy/drone-scp' }]);
    // The script works in the directory the copy went to: the same target
    expect(detectOutputs(step('restart'), { secrets: { 'deploy-host': 'prod' } })).toEqual([{ kind: 'deploy', target: 'prod:/srv/stack/shop', via: 'appleboy/drone-ssh' }]);
  });

  it('reads unambiguous shell commands only', () => {
    const outputs = detectOutputs({
      name: 'ship',
      commands: [
        'docker build -t ghcr.io/acme/app:1 . && docker push ghcr.io/acme/app:1',
        'docker buildx build --platform linux/arm64 -t localhost:5000/tools/cli:dev --push .',
        'npm publish --access public',
        'rsync -az dist/ deploy@web1:/var/www/site',
        'echo docker push nothing',
        'docker push $IMAGE',
      ],
    });
    expect(outputs.map((o) => `${o.kind} ${o.target}`)).toEqual(['image ghcr.io/acme/app', 'image localhost:5000/tools/cli', 'package npm', 'deploy web1:/var/www/site']);
  });

  it('strips tags and digests but keeps registry ports', () => {
    expect(imageName('localhost:5000/a/b:1.0')).toBe('localhost:5000/a/b');
    expect(imageName('a/b@sha256:abc')).toBe('a/b');
    expect(imageName('localhost:5000/a/b')).toBe('localhost:5000/a/b');
  });
});

describe('results in the topology', () => {
  const withConfig = (snapshot: CiSnapshot, rules = {}): CiSnapshot => ({
    ...snapshot,
    repos: snapshot.repos.map((r) => ({
      ...r,
      pipelines: r.pipelines.map((p) => attachOutputs(r.repo.slug, structuredClone(p), r.repo.slug === 'acme/shop' ? [{ name: '.woodpecker/deploy.yaml', data: WOODPECKER_DEPLOY }] : [], rules)),
    })),
  });

  it('adds a results layer on top and links each result to the step that produces it', () => {
    const topo = buildTopology(withConfig(woodpeckerSnapshot));
    expect(validateTopology(topo)).toMatchObject({ errors: [], warnings: [] });
    expect(topo.layers.map((l) => l.id)).toEqual(['step', 'workflow', 'pipeline', 'output']);
    const image = topo.nodes.find((n) => n.layer === 'output')!;
    expect(image).toMatchObject({ id: 'o:image:registry.example.com/acme/shop', label: 'acme/shop', type: 'image', column: 'acme/shop', meta: { Tags: 'latest, 1.2' } });
    const release = topo.nodes.find((n) => n.label === 'release' && n.group === 'deploy')!;
    expect(topo.edges).toContainEqual({ from: image.id, to: release.id, kind: 'builds' });
    // It is as good as the step that built it
    expect(image.status).toBe(release.status);
  });

  it('leaves topologies without results unchanged', () => {
    expect(buildTopology(woodpeckerSnapshot).layers.map((l) => l.id)).toEqual(['step', 'workflow', 'pipeline']);
  });

  it('takes outputs from the rules where the config has none, and hides them with []', () => {
    const rules = { steps: { 'acme/docs': { 'pages/publish': [{ kind: 'deploy' as const, target: 'pages:/docs' }] }, 'acme/shop': { release: [] } } };
    const topo = buildTopology(withConfig(woodpeckerSnapshot, rules));
    expect(topo.nodes.filter((n) => n.layer === 'output').map((n) => `${n.id} ${n.label}`)).toEqual(['o:deploy:pages:/docs pages:/docs']);
  });

  it('shares one node for an image several pipelines build; the latest run decides its status', () => {
    const shop = withConfig(woodpeckerSnapshot).repos[0];
    const latest = shop.pipelines[0];
    const older = structuredClone(latest);
    older.number = 41;
    const release = (p: typeof latest) => p.workflows.find((w) => w.name === 'deploy')!.steps.find((s) => s.name === 'release')!;
    release(latest).state = 'failure';
    release(older).state = 'success';
    const topo = buildTopology({ source: 'woodpecker', repos: [{ ...shop, pipelines: [latest, older] }] });
    const images = topo.nodes.filter((n) => n.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0].status).toBe('down');
    expect(topo.edges.filter((e) => e.from === images[0].id)).toHaveLength(2);
  });

  it('works for Drone with config files from a local checkout', () => {
    const pipeline = attachOutputs('acme/shop', fromDrone(undefined, 'acme/shop', droneApi.build as DroneBuild), [{ name: '.drone.yml', data: DRONE_YML }], { secrets: { 'deploy-host': 'prod' } });
    const topo = buildTopology({ source: 'drone', repos: [{ repo: { slug: 'acme/shop' }, pipelines: [pipeline] }] });
    // The build has no upload and restart steps, so only the image shows up
    expect(topo.nodes.filter((n) => n.layer === 'output').map((n) => `${n.type} ${n.label} ${n.meta?.Via}`)).toEqual(['image acme/shop plugins/docker']);
  });
});

describe('woodpecker config', () => {
  it('reads the config of each pipeline from the API, base64 as Woodpecker sends it', async () => {
    const shop = woodpeckerApi.repos[0];
    const config = [{ name: '.woodpecker/deploy.yaml', data: Buffer.from(WOODPECKER_DEPLOY).toString('base64') }];
    const routes: Record<string, unknown> = {
      '/repos/lookup/acme/shop': shop.repo,
      '/repos/3/pipelines?page=1&perPage=1&branch=main': [{ number: 42 }],
      '/repos/3/pipelines/42': shop.pipelines[0],
      '/repos/3/pipelines/42/config': config,
    };
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      const path = url.slice('https://ci.example.com/api'.length);
      calls.push(path);
      return path in routes ? new Response(JSON.stringify(routes[path])) : new Response('', { status: 404 });
    }) as typeof globalThis.fetch;
    const snapshot = await woodpecker.fetchSnapshot({ server: 'https://ci.example.com', token: 't', repos: ['acme/shop'], fetch });
    const steps = snapshot.repos[0].pipelines[0].workflows.find((w) => w.name === 'deploy')!.steps;
    expect(steps.find((s) => s.name === 'release')!.outputs).toEqual([{ kind: 'image', target: 'registry.example.com/acme/shop', tags: ['latest', '1.2'], via: 'woodpeckerci/plugin-docker-buildx' }]);

    // Without the config endpoint the graph simply has no results
    delete routes['/repos/3/pipelines/42/config'];
    const without = await woodpecker.fetchSnapshot({ server: 'https://ci.example.com', token: 't', repos: ['acme/shop'], fetch });
    expect(without.repos[0].pipelines[0].workflows.flatMap((w) => w.steps).some((s) => s.outputs)).toBe(false);
    const skipped = calls.length;
    await woodpecker.fetchSnapshot({ server: 'https://ci.example.com', token: 't', repos: ['acme/shop'], readConfig: false, fetch });
    expect(calls.slice(skipped).some((c) => c.endsWith('/config'))).toBe(false);
  });
});
