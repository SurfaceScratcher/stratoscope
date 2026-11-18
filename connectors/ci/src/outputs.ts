import { parseConfig, type ConfigFile, type StepConfig } from './config.js';
import type { CiOutput, CiPipeline } from './types.js';

/**
 * What the config cannot tell, from the connector's own configuration (`--outputs rules.json`).
 */
export interface OutputRules {
  /** Values of secrets the config only names, e.g. `{ "deploy-ssh-host": "prod" }`. Only use names, not real secrets. */
  secrets?: Record<string, string>;
  /**
   * Outputs per repository and step, replacing what was detected: `{ "acme/shop": { "deploy/upload": [...] } }`.
   * The key is `workflow/step` or just `step`; `[]` hides a step's outputs.
   */
  steps?: Record<string, Record<string, CiOutput[]>>;
}

/** Plugin image without registry prefix of Docker Hub and without tag: `plugins/docker`. */
export function pluginName(image: string): string {
  return image.replace(/@sha256:.*$/, '').replace(/:[^/:]*$/, '').replace(/^(docker\.io\/|index\.docker\.io\/)/, '').replace(/^library\//, '').toLowerCase();
}

/** A setting as text: secrets become their value from the rules or `<name>`. */
function texts(v: unknown, secrets: Record<string, string>): string[] {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap((x) => texts(x, secrets));
  if (typeof v === 'object') {
    const name = (v as Record<string, unknown>).from_secret;
    return typeof name === 'string' ? [secrets[name] ?? `<${name}>`] : [];
  }
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * `registry.example.com/team/app:1.2` → `registry.example.com/team/app`; keeps a registry port and
 * drops a tag from a variable (`app:${TAG:-latest}`) as well as Docker Hub's implicit prefixes.
 */
export function imageName(ref: string): string {
  const at = ref.trim().replace(/@sha256:.*$/, '');
  const slash = at.lastIndexOf('/');
  const colon = at.indexOf(':', slash + 1);
  return (colon >= 0 ? at.slice(0, colon) : at).replace(/^(docker\.io|index\.docker\.io)\//, '').replace(/^library\//, '');
}

const DOCKER = /(^|\/)(drone-|wp-|plugin-)?(docker|docker-buildx|buildx|kaniko|buildah|podman|ecr|gcr|docker-registry)$/;
const COPY = /(^|\/)(drone-|wp-|plugin-)?(scp|rsync|sftp|drone-scp)$/;
const SSH = /(^|\/)(drone-|wp-|plugin-)?ssh$/;
const NPM = /(^|\/)(drone-|wp-|plugin-)?npm$/;
const RELEASE = /(^|\/)(drone-|wp-|plugin-)?(gitea-release|github-release|gitlab-release|forgejo-release|release)$/;

/** Outputs a plugin step announces in its settings. */
function fromPlugin(step: StepConfig, secrets: Record<string, string>): CiOutput[] {
  const plugin = pluginName(step.image ?? '');
  const s = step.settings ?? {};
  const via = plugin;
  if (DOCKER.test(plugin)) {
    const registry = texts(s.registry, secrets)[0];
    const tags = texts(s.tags ?? s.tag, secrets);
    return texts(s.repo ?? s.repository ?? s.repos, secrets).map((repo) => {
      // Without a host part the repo lives in `registry` (Docker Hub if none)
      const qualified = registry && !/^[^/]+[.:][^/]*\//.test(repo) && !repo.startsWith(registry) ? `${registry.replace(/\/+$/, '')}/${repo}` : repo;
      return { kind: 'image' as const, target: imageName(qualified), ...(tags.length && { tags }), via };
    });
  }
  if (COPY.test(plugin)) {
    const hosts = texts(s.host ?? s.hosts, secrets);
    const targets = texts(s.target ?? s.targets ?? s.remote_path, secrets);
    return hosts.flatMap((h) => (targets.length ? targets : ['']).map((t) => ({ kind: 'deploy' as const, target: t ? `${h}:${t}` : h, via })));
  }
  if (SSH.test(plugin)) {
    // A script that starts in an absolute directory works there: the same target as a copy into it
    const script = [s.script, s.command].flatMap((v) => (typeof v === 'string' ? v.split('\n') : Array.isArray(v) ? v.map(String) : []));
    const dir = script.map((l) => l.trim().match(/^cd\s+(\/[^\s;&|]+)/)?.[1]).find(Boolean)?.replace(/\/+$/, '');
    return texts(s.host ?? s.hosts, secrets).map((h) => ({ kind: 'deploy' as const, target: dir ? `${h}:${dir}` : h, via }));
  }
  if (NPM.test(plugin)) {
    const folder = texts(s.folder, secrets)[0];
    return [{ kind: 'package', target: folder ? `npm:${folder}` : 'npm', via }];
  }
  if (RELEASE.test(plugin)) {
    return [{ kind: 'release', target: 'release', via }];
  }
  return [];
}

/** Outputs of plain shell commands that leave no doubt: `docker push`, `npm publish`, `scp`/`rsync` to a host. */
function fromCommands(step: StepConfig): CiOutput[] {
  const out: CiOutput[] = [];
  const via = 'commands';
  for (const line of step.commands ?? []) {
    for (const cmd of line.split(/&&|;|\|\|/).map((c) => c.trim())) {
      const push = cmd.match(/^(?:sudo\s+)?(?:docker|podman|buildah)\s+(?:image\s+)?push\s+(?:-\S+\s+)*([^\s$]\S*)/);
      if (push) out.push({ kind: 'image', target: imageName(push[1]), via });
      if (/^(?:docker|podman)\s+buildx\s+build\b.*\s--push\b/.test(cmd)) {
        for (const m of cmd.matchAll(/\s(?:-t|--tag)[\s=]+([^\s$]\S*)/g)) out.push({ kind: 'image', target: imageName(m[1]), via });
      }
      if (/^(?:npm|pnpm|yarn(?:\s+npm)?)\s+publish\b/.test(cmd) || /^npx\s+changeset\s+publish\b/.test(cmd)) out.push({ kind: 'package', target: 'npm', via });
      const copy = cmd.match(/^(?:scp|rsync)\s.*\s(?:[\w.-]+@)?([\w.-]+):(\/\S*)\s*$/);
      if (copy) out.push({ kind: 'deploy', target: `${copy[1]}:${copy[2]}`, via });
    }
  }
  return out;
}

/** What a step produces, from its config. Duplicates (e.g. two pushes of one image) are merged. */
export function detectOutputs(step: StepConfig, rules: OutputRules = {}): CiOutput[] {
  const found = [...fromPlugin(step, rules.secrets ?? {}), ...fromCommands(step)];
  const byKey = new Map<string, CiOutput>();
  for (const o of found) {
    const key = `${o.kind}\0${o.target}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, o);
    else if (o.tags) prev.tags = [...new Set([...(prev.tags ?? []), ...o.tags])];
  }
  return [...byKey.values()];
}

/**
 * Fills `outputs` of the pipeline's steps from its config files and the rules; returns the
 * pipeline. Workflows are matched by name, steps by name within their workflow; a single
 * workflow is matched to a single config workflow whatever their names.
 */
export function attachOutputs(repo: string, pipeline: CiPipeline, files: ConfigFile[] = [], rules: OutputRules = {}): CiPipeline {
  const configs = files.flatMap((f) => parseConfig(f));
  const byName = new Map(configs.map((w) => [w.name, w]));
  const overrides = rules.steps?.[repo] ?? {};
  for (const w of pipeline.workflows) {
    const config = byName.get(w.name) ?? (configs.length === 1 && pipeline.workflows.length === 1 ? configs[0] : undefined);
    const steps = new Map(config?.steps.map((s) => [s.name, s]));
    for (const step of w.steps) {
      const override = overrides[`${w.name}/${step.name}`] ?? overrides[step.name];
      const cfg = steps.get(step.name);
      const outputs = override ?? (cfg ? detectOutputs(cfg, rules) : []);
      if (outputs.length) step.outputs = outputs;
      else delete step.outputs;
    }
  }
  return pipeline;
}
