/**
 * Source-neutral model of CI runs. Every source (Woodpecker, Drone, …) translates its API into
 * this shape; the topology is built from it alone.
 */
import type { ConfigFile } from './config.js';
import type { OutputRules } from './outputs.js';

/** success, failure, error, killed, running, pending, skipped, canceled, blocked, declined, … as the CI reports it. */
export type CiState = string;

export interface CiStep {
  name: string;
  state: CiState;
  /** `clone` fetches the code, a `service` (database, cache) runs next to the other steps. */
  kind: 'clone' | 'service' | 'step';
  /** Names of steps of the same workflow this one waits for. */
  dependsOn?: string[];
  exitCode?: number;
  error?: string;
  /** Unix seconds. */
  started?: number;
  finished?: number;
  /** Page of this step in the CI's web UI. */
  link?: string;
  /** What the step produces or where it delivers to, from the pipeline config. */
  outputs?: CiOutput[];
}

/**
 * Result of a step: `image` (container image, without tag), `package` (npm, …), `release`,
 * `deploy` (host or `host:path`), `artifact` (anything else).
 */
export interface CiOutput {
  kind: 'image' | 'package' | 'release' | 'deploy' | 'artifact';
  /** What it is or where it goes: `registry.example.com/team/app`, `prod:/srv/app`, `npm:packages/core`. */
  target: string;
  tags?: string[];
  /** How it was found: the plugin image (`plugins/docker`), `commands`, or `rules` for manual ones. */
  via?: string;
}

/** Woodpecker workflow, Drone stage: one pipeline definition (config file or YAML document). */
export interface CiWorkflow {
  name: string;
  state: CiState;
  /** Names of workflows of the same pipeline this one waits for. */
  dependsOn?: string[];
  error?: string;
  started?: number;
  finished?: number;
  link?: string;
  /** In the order the CI lists them; without `dependsOn` they run one after another. */
  steps: CiStep[];
}

/** Woodpecker pipeline, Drone build: one run for a commit. */
export interface CiPipeline {
  number: number;
  state: CiState;
  event?: string;
  branch?: string;
  commit?: string;
  message?: string;
  author?: string;
  started?: number;
  finished?: number;
  link?: string;
  workflows: CiWorkflow[];
}

export interface CiRepo {
  /** `owner/name`. */
  slug: string;
  link?: string;
}

/** Input of `buildTopology`; written with `--format snapshot` to replay later without the server. */
export interface CiSnapshot {
  /** `woodpecker`, `drone`, … */
  source: string;
  server?: string;
  repos: { repo: CiRepo; pipelines: CiPipeline[] }[];
}

/** Connection to a CI server. */
export interface FetchOptions {
  /** Base URL, e.g. `https://ci.example.com`. */
  server: string;
  /** Personal access token from the user profile in the CI's web UI. */
  token: string;
  /** `owner/name` of the repositories to read. Default: every active repository of the token's user. */
  repos?: string[];
  /** Latest pipelines per repository. Default 1. */
  pipelines?: number;
  /** Only pipelines of this branch; `null` for any branch. Default: the repository's default branch. */
  branch?: string | null;
  /**
   * Read each pipeline's config to find what its steps produce. Woodpecker serves it through its
   * API; Drone does not, so pass `configFiles` instead. Default true.
   */
  readConfig?: boolean;
  /** Config files per repository (`owner/name`), e.g. read from local checkouts; used where the API has none. */
  configFiles?: Record<string, ConfigFile[]>;
  /** Outputs the config does not show; see `OutputRules`. */
  outputRules?: OutputRules;
  /** Replaces the global `fetch`, for tests. */
  fetch?: typeof fetch;
}

export interface CiSource {
  name: string;
  fetchSnapshot(opts: FetchOptions): Promise<CiSnapshot>;
}
