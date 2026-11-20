import { statusOfState } from '../build.js';
import type { CiPipeline, FetchOptions } from '../types.js';

/** A pipeline as the CI's list returns it: enough to decide whether to load it. */
export interface RunSummary {
  number: number;
  event?: string;
  branch?: string;
}

/** Older runs of one repository, newest first. */
export interface OlderRuns {
  /** One page of the pipeline list, newest first. */
  list(page: number, perPage: number): Promise<RunSummary[]>;
  /** The whole pipeline with `outputs` attached. */
  load(summary: RunSummary): Promise<CiPipeline>;
}

const PER_PAGE = 50;
export const DEFAULT_RESULTS_DEPTH = 100;

const keyOf = (o: { kind: string; target: string }) => `${o.kind}\0${o.target}`;

/** Results a pipeline really produced or failed to: steps with outputs that finished (success or failure). */
function settled(p: CiPipeline): Set<string> {
  const keys = new Set<string>();
  for (const w of p.workflows) for (const s of w.steps) if (statusOfState(s.state) !== 'unknown') for (const o of s.outputs ?? []) keys.add(keyOf(o));
  return keys;
}

/** Whether a run counts for the results: any run without filters, else one on a listed branch or of a listed event. */
function qualifies(run: RunSummary, branches: string[], events: string[]): boolean {
  if (!branches.length && !events.length) return true;
  return (!!run.branch && branches.includes(run.branch)) || (!!run.event && events.includes(run.event));
}

/** The pipeline cut down to the finished steps that produce `wanted`, each with only those outputs. */
function prune(p: CiPipeline, wanted: Set<string>): CiPipeline | undefined {
  const workflows = p.workflows
    .map((w) => ({
      ...w,
      steps: w.steps
        .filter((s) => statusOfState(s.state) !== 'unknown')
        .map((s) => ({ ...s, outputs: s.outputs?.filter((o) => wanted.has(keyOf(o))) }))
        .filter((s) => s.outputs?.length),
    }))
    .filter((w) => w.steps.length);
  return workflows.length ? { ...p, workflows } : undefined;
}

/**
 * `results: 'latest'`: for every result the config of the fetched pipelines can produce and that
 * none of them settled, the latest older run whose producing step finished. Pages back through the
 * list until every result is found or `resultsDepth` runs were loaded. Each returned pipeline only
 * keeps the steps that produce those results.
 */
export async function latestProducers(fetched: CiPipeline[], possible: Iterable<{ kind: string; target: string }>, older: OlderRuns, opts: FetchOptions, defaultBranch?: string): Promise<CiPipeline[]> {
  const missing = new Set([...possible].map(keyOf));
  for (const p of fetched) for (const k of settled(p)) missing.delete(k);
  const branches = (opts.resultsBranches ?? []).map((b) => (b === 'default' ? defaultBranch ?? b : b));
  const events = opts.resultsEvents ?? [];
  const depth = Math.max(0, opts.resultsDepth ?? DEFAULT_RESULTS_DEPTH);
  const seen = new Set(fetched.map((p) => p.number));
  const producers: CiPipeline[] = [];
  let loaded = 0;
  for (let page = 1; missing.size && loaded < depth; page++) {
    const list = await older.list(page, PER_PAGE);
    for (const run of list) {
      if (!missing.size || loaded >= depth) break;
      if (seen.has(run.number) || !qualifies(run, branches, events)) continue;
      seen.add(run.number);
      loaded++;
      const pipeline = prune(await older.load(run), missing);
      if (!pipeline) continue;
      producers.push(pipeline);
      for (const k of settled(pipeline)) missing.delete(k);
    }
    if (list.length < PER_PAGE) break;
  }
  return producers;
}
