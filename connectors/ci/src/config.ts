import { parseAllDocuments } from 'yaml';

/** One pipeline config file as the CI stores it: `.woodpecker/build.yaml`, `.drone.yml`, … */
export interface ConfigFile {
  /** Path in the repository; Woodpecker names its workflows after it. */
  name?: string;
  /** The YAML text. */
  data: string;
}

/** The parts of a step's config that tell what it produces. */
export interface StepConfig {
  name: string;
  image?: string;
  settings?: Record<string, unknown>;
  commands?: string[];
}

export interface WorkflowConfig {
  name: string;
  steps: StepConfig[];
}

/**
 * Workflow name Woodpecker gives a config file: `.woodpecker/build.yaml` → `build`,
 * `.woodpecker.yml` → `woodpecker`.
 */
export function workflowNameOf(file: string): string {
  return (file.split('/').pop() ?? file).replace(/\.ya?ml$/, '').replace(/^\./, '');
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asLines = (v: unknown): string[] | undefined =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : undefined;

function stepOf(name: string, raw: unknown): StepConfig | null {
  if (!isObject(raw)) return null;
  return {
    name: typeof raw.name === 'string' ? raw.name : name,
    image: typeof raw.image === 'string' ? raw.image : undefined,
    settings: isObject(raw.settings) ? raw.settings : undefined,
    commands: asLines(raw.commands),
  };
}

function stepsOf(raw: unknown): StepConfig[] {
  // Woodpecker allows a map of name → step as well as a list
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((s, i) => [String(isObject(s) && s.name ? s.name : i + 1), s])
    : isObject(raw) ? Object.entries(raw) : [];
  return entries.map(([name, s]) => stepOf(name, s)).filter((s): s is StepConfig => !!s);
}

/**
 * The workflows of one config file. Drone: one per `kind: pipeline` document, named by its
 * `name` (default `default`). Woodpecker: one per file, named after the file.
 * Unreadable YAML yields no workflows rather than an error: the graph works without them.
 */
export function parseConfig(file: ConfigFile): WorkflowConfig[] {
  const workflows: WorkflowConfig[] = [];
  for (const doc of parseAllDocuments(file.data)) {
    if (!('errors' in doc) || doc.errors.length) continue;
    const raw: unknown = doc.toJS();
    if (!isObject(raw)) continue;
    if (typeof raw.kind === 'string') {
      // Drone: secrets and signatures are documents too
      if (raw.kind === 'pipeline') workflows.push({ name: typeof raw.name === 'string' ? raw.name : 'default', steps: stepsOf(raw.steps) });
    } else if (raw.steps || raw.pipeline) {
      // `pipeline:` is the name before Woodpecker 2.0
      workflows.push({ name: workflowNameOf(file.name ?? '.woodpecker.yml'), steps: stepsOf(raw.steps ?? raw.pipeline) });
    }
  }
  return workflows;
}
