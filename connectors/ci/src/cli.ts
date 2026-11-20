#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { DEFAULT_THEME, toDrawio, toSvg, validateTopology, type DiagramView } from 'stratoscope/core';
import { buildTopology, statusOf } from './build.js';
import type { ConfigFile } from './config.js';
import type { OutputRules } from './outputs.js';
import { detectSource, SOURCES } from './sources/index.js';
import type { CiSnapshot } from './types.js';

const USAGE = `Usage: stratoscope-ci [options]

Reads CI pipelines with their workflows (Drone: stages) and steps and writes a layered topology.

Connection, from the environment the CI's own CLI uses:
  Woodpecker   WOODPECKER_SERVER and WOODPECKER_TOKEN
  Drone        DRONE_SERVER and DRONE_TOKEN
The token is a personal access token from your user profile in the CI's web UI.

Options:
  -s, --source <name>       woodpecker | drone (default: from the environment)
  -r, --repo <owner/name>   repository to read; repeat for more (default: all active ones)
  -n, --pipelines <n>       latest pipelines per repository (default: 1)
  -b, --branch <name>       only this branch; "*" for any (default: the repository's default branch)
  -f, --format <format>     json | svg | drawio | snapshot (default: json)
      --view <view>         columns | layers, for svg (default: columns)
      --dark                dark colours, for svg
      --from <file>         build from a snapshot written with --format snapshot instead of the API

Results (images, packages, releases, deploy targets) come from the pipeline config:
      --config <owner/name>=<file>
                            config file of a repository, e.g. from a local checkout; repeat for
                            more. Needed for Drone, whose API has none; Woodpecker serves its own
      --skip-config         do not read the config from the Woodpecker API
      --outputs <file>      JSON rules for what the config does not show:
                            { "secrets": { "deploy-host": "prod" },
                              "steps": { "owner/name": { "workflow/step": [{ "kind": "deploy", "target": "prod:/srv/app" }] } } }
      --results <mode>      window: results of the fetched pipelines only (default)
                            latest: every result the config can produce, from the latest run
                            whose producing step finished, however far back
      --results-branch <b>  with latest: only runs on this branch count; "default" for the
                            repository's default branch; repeat for more (default: any)
      --results-event <e>   with latest: runs of this event count too (tag, deployment, cron, …);
                            repeat for more
      --results-depth <n>   with latest: older runs to load per repository at most (default: 100)
  -o, --out <file>          write here (default: stdout)
  -h, --help                show this help
`;

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', short: 's' },
      repo: { type: 'string', short: 'r', multiple: true },
      pipelines: { type: 'string', short: 'n', default: '1' },
      branch: { type: 'string', short: 'b' },
      format: { type: 'string', short: 'f', default: 'json' },
      view: { type: 'string', default: 'columns' },
      dark: { type: 'boolean' },
      from: { type: 'string' },
      config: { type: 'string', multiple: true },
      'skip-config': { type: 'boolean' },
      outputs: { type: 'string' },
      results: { type: 'string', default: 'window' },
      'results-branch': { type: 'string', multiple: true },
      'results-event': { type: 'string', multiple: true },
      'results-depth': { type: 'string' },
      out: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return void process.stdout.write(USAGE);
  const format = values.format!;
  if (!['json', 'svg', 'drawio', 'snapshot'].includes(format)) fail(`unknown format "${format}"`);
  const view = values.view as DiagramView;
  if (view !== 'layers' && view !== 'columns') fail(`unknown view "${values.view}"`);
  const results = values.results;
  if (results !== 'window' && results !== 'latest') fail(`unknown results mode "${results}"`);
  const resultsDepth = values['results-depth'] === undefined ? undefined : Number(values['results-depth']);
  if (resultsDepth !== undefined && (!Number.isInteger(resultsDepth) || resultsDepth < 0)) fail('--results-depth must be a number');

  let snapshot: CiSnapshot;
  if (values.from) {
    snapshot = JSON.parse(fs.readFileSync(values.from, 'utf8'));
    if (!Array.isArray(snapshot.repos)) fail(`${values.from} is not a snapshot`);
  } else {
    const detected = detectSource(process.env);
    const source = values.source ? SOURCES[values.source] : detected?.source;
    if (!source) fail(values.source ? `unknown source "${values.source}"` : 'set WOODPECKER_SERVER and WOODPECKER_TOKEN, or DRONE_SERVER and DRONE_TOKEN, or use --from');
    const prefix = source!.name.toUpperCase();
    const server = process.env[`${prefix}_SERVER`], token = process.env[`${prefix}_TOKEN`];
    if (!server || !token) fail(`set ${prefix}_SERVER and ${prefix}_TOKEN`);
    const pipelines = Number(values.pipelines);
    if (!Number.isInteger(pipelines) || pipelines < 1) fail('--pipelines must be a positive number');
    const configFiles: Record<string, ConfigFile[]> = {};
    for (const spec of values.config ?? []) {
      const [repo, file] = [spec.slice(0, spec.indexOf('=')), spec.slice(spec.indexOf('=') + 1)];
      if (!repo || !file || !spec.includes('=')) fail(`--config needs <owner/name>=<file>, got "${spec}"`);
      (configFiles[repo] ??= []).push({ name: file.split('/').slice(-2).join('/'), data: fs.readFileSync(file, 'utf8') });
    }
    const outputRules: OutputRules | undefined = values.outputs ? JSON.parse(fs.readFileSync(values.outputs, 'utf8')) : undefined;
    snapshot = await source!.fetchSnapshot({
      readConfig: !values['skip-config'],
      configFiles,
      outputRules,
      results,
      resultsBranches: values['results-branch'],
      resultsEvents: values['results-event'],
      resultsDepth,
      server: server!,
      token: token!,
      repos: values.repo,
      pipelines,
      branch: values.branch === '*' ? null : values.branch,
    });
  }

  let output: string;
  if (format === 'snapshot') {
    output = JSON.stringify(snapshot, null, 2) + '\n';
  } else {
    const topology = buildTopology(snapshot);
    const { errors } = validateTopology(topology);
    if (errors.length) fail(`invalid topology:\n  ${errors.join('\n  ')}`);
    const status = statusOf(topology);
    // The topology carries its profile and status, so the exports need no options for them
    if (format === 'svg') output = toSvg(topology, { view, theme: values.dark ? DEFAULT_THEME : undefined });
    else if (format === 'drawio') output = toDrawio(topology, { pageNames: { columns: 'Repositories' } });
    else output = JSON.stringify(topology, null, 2) + '\n';
    const down = Object.values(status).filter((s) => s === 'down').length;
    process.stderr.write(`${topology.columns?.length ?? 0} repositories with pipelines, ${topology.nodes.length} nodes, ${topology.edges.length} edges, ${down} failed\n`);
  }
  if (values.out) fs.writeFileSync(values.out, output);
  else process.stdout.write(output);
}

function fail(message: string): never {
  process.stderr.write(`stratoscope-ci: ${message}\n`);
  process.exit(1);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
