import { SCHEMA_VERSION, type GraphEdge, type GraphNode, type NodeStatus, type Topology } from 'stratoscope/core';
import { CI_PROFILE } from './profile.js';
import type { CiOutput, CiPipeline, CiSnapshot, CiState, CiStep, CiWorkflow } from './types.js';

export interface BuildOptions {
  /** Topology name. Default "CI pipelines". */
  name?: string;
}

/** Bottom to top: steps carry the work, pipelines are what people look at. */
export const LAYERS = [
  { id: 'step', label: 'Steps' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'pipeline', label: 'Pipelines' },
];

/** On top, only when some step has outputs: what the pipelines produce. */
export const OUTPUT_LAYER = { id: 'output', label: 'Results' };

/**
 * Node id of a result. Images and deploy targets are shared: one node however many repositories
 * build or deliver to them. Packages, releases and artifacts belong to their repository.
 */
export function outputId(o: CiOutput, repo: string): string {
  return o.kind === 'image' || o.kind === 'deploy' ? `o:${o.kind}:${o.target}` : `o:${o.kind}:${repo}:${o.target}`;
}

/** Short label: the last two path parts of an image, `host:…/dir` of a target, the repository's name for the rest. */
export function outputLabel(o: CiOutput, repo: string): string {
  if (o.kind === 'image') return o.target.split('/').slice(-2).join('/');
  if (o.kind === 'deploy') {
    const [host, path] = o.target.split(/:(?=\/)/);
    const parts = path?.split('/').filter(Boolean) ?? [];
    if (!path) return host;
    const dir = `${parts.length > 2 ? '…/' : '/'}${parts.slice(-2).join('/')}`;
    // An unresolved secret (`<deploy-host>`) says less than the directory
    return host.startsWith('<') ? dir : `${host}:${dir}`;
  }
  const name = repo.split('/').pop()!;
  return o.target === o.kind || o.target === 'npm' || o.target === 'release' ? `${name} ${o.kind}` : `${name} ${o.target}`;
}

/**
 * CI state → node status. Failures are `down`; everything that is not finished yet or did not run
 * (pending, running, skipped, canceled, blocked, declined, waiting_on_dependencies) is `unknown`.
 */
export function statusOfState(state: CiState | undefined): NodeStatus {
  switch (state) {
    case 'success': return 'ok';
    case 'failure': case 'error': case 'killed': return 'down';
    default: return 'unknown';
  }
}

/** Status per node: the `status` it carries, else derived from `meta.State`. */
export function statusOf(topology: Topology): Record<string, NodeStatus> {
  return Object.fromEntries(topology.nodes.map((n) => [n.id, n.status ?? statusOfState(String(n.meta?.State ?? ''))]));
}

/**
 * One column per repository; the steps of a workflow form a group. Edges:
 * - pipeline → workflow: `contains`, workflow → step: `runs`
 * - workflow → workflow, step → step from `dependsOn`: `needs`
 * - steps of a workflow without any `dependsOn` run in order: `after` the previous one
 *   (with `dependsOn` in use, steps without it start right after the clone)
 * - step → service of the same workflow: `uses`
 * - result → step that produces it: `builds`, or `deploys` for deploy targets
 * The topology carries CI_PROFILE and each node its `status`, so stratoscope shows it right away.
 */
export function buildTopology(snapshot: CiSnapshot, opts: BuildOptions = {}): Topology {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const results = new Results(nodes, edges);

  for (const { repo, pipelines, producers } of snapshot.repos) {
    const column = repo.slug;
    for (const p of pipelines) {
      const pid = `p:${column}#${p.number}`;
      // Several pipelines of one repository need the number to tell their workflows apart
      const groupOf = (w: CiWorkflow) => (pipelines.length > 1 ? `#${p.number} ${w.name}` : w.name);
      nodes.push({
        id: pid,
        label: `#${p.number} ${p.branch ?? p.event ?? ''}`.trim(),
        type: 'pipeline',
        layer: 'pipeline',
        column,
        status: statusOfState(p.state),
        meta: pipelineMeta(p),
      });

      const workflowId = (w: CiWorkflow) => `w:${column}#${p.number}/${w.name}`;
      const byName = new Map(p.workflows.map((w) => [w.name, w]));
      for (const w of p.workflows) {
        const wid = workflowId(w);
        nodes.push({ id: wid, label: w.name, type: 'workflow', layer: 'workflow', column, status: statusOfState(w.state), meta: runMeta(w) });
        edges.push({ from: pid, to: wid, kind: 'contains' });
        for (const dep of w.dependsOn ?? []) {
          const target = byName.get(dep);
          if (target) edges.push({ from: wid, to: workflowId(target), kind: 'needs' });
        }
        addSteps(w, wid, column, groupOf(w), nodes, edges, (s, id) => results.add(s, id, column, p.number));
      }
    }
    // Older runs only for the results: their steps are not in the graph, the result names the run
    for (const p of producers ?? []) for (const w of p.workflows) for (const s of w.steps) results.add(s, undefined, column, p.number);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    name: opts.name ?? 'CI pipelines',
    profile: CI_PROFILE,
    layers: results.any ? [...LAYERS, OUTPUT_LAYER] : LAYERS,
    columns: snapshot.repos.filter((r) => r.pipelines.length).map((r) => r.repo.slug),
    nodes,
    edges,
  };
}

/** Result nodes, shared across pipelines and repositories, with the status of their latest producer. */
class Results {
  private byId = new Map<string, { node: GraphNode; pipeline: number }>();
  constructor(private nodes: GraphNode[], private edges: GraphEdge[]) {}
  get any() { return this.byId.size > 0; }

  /** `stepId` is left out for steps of runs that are not in the graph. */
  add(step: CiStep, stepId: string | undefined, repo: string, pipeline: number) {
    for (const o of step.outputs ?? []) {
      const id = outputId(o, repo);
      const status = statusOfState(step.state);
      let entry = this.byId.get(id);
      if (!entry) {
        const node: GraphNode = { id, label: outputLabel(o, repo), type: o.kind, layer: OUTPUT_LAYER.id, column: repo, status, meta: { Target: o.target } };
        entry = { node, pipeline };
        this.byId.set(id, entry);
        this.nodes.push(node);
        setRun(node, repo, pipeline, step);
      } else if (status !== 'unknown' && (entry.node.status === 'unknown' || pipeline > entry.pipeline)) {
        // A skipped run says nothing about the result; otherwise the latest run counts
        entry.node.status = status;
        entry.pipeline = pipeline;
        setRun(entry.node, repo, pipeline, step);
      }
      const meta = entry.node.meta!;
      if (o.tags?.length) meta.Tags = [...new Set([...String(meta.Tags ?? '').split(', ').filter(Boolean), ...o.tags])].join(', ');
      if (o.via && !String(meta.Via ?? '').split(', ').includes(o.via)) meta.Via = meta.Via ? `${meta.Via}, ${o.via}` : o.via;
      if (stepId) this.edges.push({ from: id, to: stepId, kind: o.kind === 'deploy' ? 'deploys' : 'builds' });
    }
  }
}

/** The run a result's status comes from: `#42`, or `owner/name#42` for a shared result of another repository. */
function setRun(node: GraphNode, repo: string, pipeline: number, step: CiStep) {
  const meta = node.meta!;
  meta.Pipeline = node.column === repo ? `#${pipeline}` : `${repo}#${pipeline}`;
  if (step.link) meta.Link = step.link;
  else delete meta.Link;
}

function addSteps(w: CiWorkflow, wid: string, column: string, group: string, nodes: GraphNode[], edges: GraphEdge[], onStep: (s: CiStep, id: string) => void) {
  // Position in the workflow: names are not always unique
  const index = new Map(w.steps.map((s, i) => [s, i + 1]));
  const stepId = (s: CiStep) => `s:${wid.slice(2)}/${index.get(s)}`;
  const services = w.steps.filter((s) => s.kind === 'service');
  const work = w.steps.filter((s) => s.kind !== 'service');
  const clone = work.find((s) => s.kind === 'clone');
  const byName = new Map(work.map((s) => [s.name, s]));
  const dag = work.some((s) => s.dependsOn?.length);

  for (const s of w.steps) {
    const id = stepId(s);
    const role = s.kind === 'step' ? undefined : s.kind;
    nodes.push({ id, label: s.name, type: 'step', layer: 'step', column, group, ...(role && { role }), status: statusOfState(s.state), meta: runMeta(s) });
    edges.push({ from: wid, to: id, kind: 'runs' });
    onStep(s, id);
  }

  work.forEach((s, i) => {
    const id = stepId(s);
    if (dag) {
      const deps = (s.dependsOn ?? []).map((d) => byName.get(d)).filter((d): d is CiStep => !!d);
      for (const d of deps) edges.push({ from: id, to: stepId(d), kind: 'needs' });
      if (!deps.length && clone && s !== clone) edges.push({ from: id, to: stepId(clone), kind: 'after' });
    } else if (i > 0) {
      edges.push({ from: id, to: stepId(work[i - 1]), kind: 'after' });
    }
    if (s !== clone) for (const svc of services) edges.push({ from: id, to: stepId(svc), kind: 'uses' });
  });
}

function pipelineMeta(p: CiPipeline): Record<string, string | number> {
  const meta = runMeta(p);
  if (p.event) meta.Event = p.event;
  if (p.branch) meta.Branch = p.branch;
  if (p.commit) meta.Commit = p.commit.slice(0, 8);
  const message = p.message?.split('\n')[0].trim();
  if (message) meta.Message = message.length > 120 ? `${message.slice(0, 119)}…` : message;
  if (p.author) meta.Author = p.author;
  return meta;
}

function runMeta(run: { state: CiState; started?: number; finished?: number; exitCode?: number; error?: string; link?: string }): Record<string, string | number> {
  const meta: Record<string, string | number> = { State: run.state };
  if (run.started && run.finished && run.finished >= run.started) meta.Duration = formatDuration(run.finished - run.started);
  if (run.exitCode) meta['Exit code'] = run.exitCode;
  if (run.error) meta.Error = run.error;
  // Not `URL`: stratoscope would take that as a health check target
  if (run.link) meta.Link = run.link;
  return meta;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
