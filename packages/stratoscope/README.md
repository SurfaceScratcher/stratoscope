# stratoscope

See how things hang together. stratoscope shows connected data as stacked 3D layers you can
rotate, zoom and click through, plus two 2D diagrams of the same graph that export to SVG and
draw.io. Click a node to see what it **needs** and what is **affected** when it fails.

It is domain-neutral: a **domain profile** says what the node types and edge kinds mean, how
they look and how failures travel. Infrastructure, CI pipelines, tasks or teams are just
different profiles over the same core.

| Domain | Package |
| --- | --- |
| Infrastructure: hosts, networks, containers, endpoints | [infra3d](https://github.com/SurfaceScratcher/infra3d) |
| CI pipelines from Woodpecker or Drone | [stratoscope-ci](https://github.com/SurfaceScratcher/stratoscope/tree/main/connectors/ci) |

```bash
npm install stratoscope three @react-three/fiber @react-three/drei
```

Requires React 19, `@react-three/fiber` 9 and `@react-three/drei` 10. Only the 3D scene needs
three.js: `stratoscope/diagram` needs React alone, `stratoscope/core` nothing at all.

## The data

```json
{
  "schemaVersion": 1,
  "name": "Release pipeline",
  "profile": "ci",
  "layers": [{ "id": "step", "label": "Steps" }, { "id": "workflow", "label": "Workflows" }],
  "columns": ["acme/shop"],
  "nodes": [
    { "id": "w:test", "label": "test", "type": "workflow", "layer": "workflow", "column": "acme/shop", "status": "down" },
    { "id": "s:unit", "label": "unit", "type": "step", "layer": "step", "column": "acme/shop", "group": "test" }
  ],
  "edges": [{ "from": "w:test", "to": "s:unit", "kind": "runs" }]
}
```

- **Layers** are listed bottom to top.
- **Edges point from the dependent to what it depends on**. Both highlight directions follow
  from that: *needs* walks the edges forward, *affects* walks them backward.
- Optional node fields: `column` (a layout column, e.g. a host or a repository), `group` (a group
  within the column, e.g. a stack or a workflow), `role` (the profile can give roles their own
  shape), `check` (probe target for the health analysis), `status` (`ok`, `down`, `suspect` or
  `unknown`, as reported by the source), `offset` (`[x, z]` nudge), `meta` (shown by your UI).
- `profile`: the whole [domain profile](#domain-profiles), or the name of one your app knows.

The JSON schema ships as `stratoscope/topology.schema.json`. `validateTopology()` also checks
cross-references the schema cannot express:

```ts
import { validateTopology } from 'stratoscope/core';

const { valid, errors, warnings } = validateTopology(JSON.parse(text), { profiles: { ci: CI_PROFILE } });
```

## `<Scene>`: 3D

```tsx
import { Scene, type SceneHandle } from 'stratoscope';

const [selected, setSelected] = useState<string | null>(null);

<div style={{ height: 600 }}>
  <Scene topology={topology} selectedId={selected} onSelect={setSelected} />
</div>
```

The scene fills its parent, so give the parent a height.

| Prop | Type | |
| --- | --- | --- |
| `topology` | `Topology` | required; keep the object stable, a new object re-runs the layout |
| `selectedId` | `string \| null` | highlighted node; the camera flies to it |
| `onSelect` | `(id \| null) => void` | click on a node, or `null` on empty space |
| `mode` | `'deps' \| 'impact' \| 'both'` | which direction to highlight, default `both` |
| `hiddenLayers` | `string[]` | layer ids to hide |
| `profile` | `DomainProfile` | default: the one the topology carries, else `DEFAULT_PROFILE` |
| `showAllLabels` | `boolean` | label every node, also those the profile labels only on hover |
| `status` | `Record<id, 'ok' \| 'down' \| 'suspect' \| 'unknown'>` | failed nodes pulse red, suspects are orange; default: the nodes' `status` |
| `theme` | `Partial<Theme>` | colours and font, merged into `DEFAULT_THEME` and the profile's colours |
| `layout` | `LayoutOptions` | spacing, anchor layer and group arrangement |
| `cameraAngle` | `{ azimuth, polar }` | viewing angle of the overview in radians |
| `ref` | `Ref<SceneHandle>` | `ref.current.fitAll()` moves the camera back to the overview |

The overview always shows the whole scene: the camera distance follows from the scene size and
the aspect ratio of the container. Resizes and topology updates refit the view until the user
moves the camera.

## `<Diagram>`: 2D views

```tsx
import { Diagram, type DiagramHandle } from 'stratoscope/diagram'; // React only, no three.js

<Diagram view="columns" topology={topology} selectedId={selected} onSelect={setSelected} />
```

- `view="layers"`: one band per layer and one strip per column, so everything that belongs to a
  column lines up underneath it.
- `view="columns"`: one card per column with its nodes by layer; the groups of the anchor layer
  are boxes. Edges the profile marks `impliedByColumn` are drawn only when highlighted.

It takes the props of `<Scene>` except the camera and label options, plus `view`. Drag to pan,
scroll or pinch to zoom; nodes are buttons that Tab and Enter reach, Escape clears the selection,
`+`, `-` and `0` zoom. `ref.current.fitAll()` shows the whole diagram and `ref.current.toSVG()`
returns it as a standalone SVG file.

### SVG and draw.io

```ts
import { toDrawio, toSvg } from 'stratoscope/core';

fs.writeFileSync('graph.drawio', toDrawio(topology));
fs.writeFileSync('graph.svg', toSvg(topology, { view: 'columns' }));
```

`toDrawio` writes an uncompressed draw.io file with one page per view. Bands, cards and groups
are containers and every edge is attached to its nodes, so the diagram stays editable; `http(s)`
check targets become links and every node has a tooltip. To embed it in XWiki or Confluence,
insert the draw.io macro and import the file (*File → Import from → Device*). `toSvg` renders one
view without a browser, e.g. on a server. Both use the light `DRAWIO_THEME`; pass `theme` to
change it. The layout behind them is `computeDiagramLayout(topology, { view })`, a pure function.

## Domain profiles

A profile is plain, JSON-compatible data:

```ts
import type { DomainProfile } from 'stratoscope/core';

const CI: DomainProfile = {
  id: 'ci',
  label: 'CI pipelines',
  anchorLayer: 'step',
  anchorGroups: 'columns',
  nodeTypes: {
    pipeline: { label: 'Pipeline', shape: 'wide', emphasis: true, color: '#f7bc94' },
    workflow: { label: 'Workflow', shape: 'hexagon', color: '#cbb6f3' },
    step: { label: 'Step', shape: 'diamond', labelOnHover: true, color: '#97d7df' },
  },
  roles: { service: { shape: 'cylinder' } },
  edgeKinds: {
    contains: { label: ['consists of', 'part of'], structural: true, pull: 1 },
    runs: { label: ['runs', 'step of'], structural: true, pull: 1, impliedByColumn: true },
    needs: { label: ['needs', 'needed by'], structural: true },
    // A failing notification blocks nothing
    notifies: { line: 'dashed', faint: true, propagates: false },
  },
};
```

| Field | |
| --- | --- |
| `nodeTypes` | per type: `label`, `shape`, `color`, `emphasis` (bold label), `labelOnHover` (3D) |
| `roles` | shape overrides by `node.role` |
| `edgeKinds` | per kind: `label` ([outgoing, incoming]), `line` (`solid`/`dashed`), `color`, `faint`, `propagates` (a failure travels along it, default true), `structural` and `proxy` (health analysis), `pull` (3D layout), `impliedByColumn` (columns view) |
| `anchorLayer` | the layer laid out on a grid per column and group; the others follow. Default: the bottom layer |
| `anchorGroups` | 3D: the groups one behind the other (`rows`, default) or side by side (`columns`) |
| `defaultShape` | shape of unknown types, default `box` |
| `looseColumn` | name of the column for nodes without one, default `Other` |

Shapes are abstract (`box`, `wide`, `slab`, `hexagon`, `ring`, `diamond`, `cylinder`); the 3D scene,
the SVG and draw.io each draw them their own way. Colours from the profile fill in what the theme
does not set (`resolveTheme(theme, profile)`).

**Where the profile comes from:** a topology can carry it (`topology.profile`), so the data
explains itself, and every function and component uses it without being told. A topology can also
name one (`"profile": "ci"`); `resolveProfile(topology, known, fallback)` looks the name up in
`known` and otherwise returns `fallback`, by default `DEFAULT_PROFILE`: plain boxes, every edge
passes a failure on, the bottom layer anchors the layout. Domain packages wrap this with their own
profiles; infra3d, for example, falls back to its infrastructure profile.

## Health analysis

Probe only some nodes (e.g. endpoints, from outside) and let the graph narrow down the cause:

```ts
import { analyzeHealth } from 'stratoscope/core';

const { status, down, suspects, causes } = analyzeHealth(topology, { 'e:shop': { ok: false, answered: true }, 'e:wiki': { ok: true } });
```

1. A working probe proves everything it structurally depends on (`structural` edges) works.
2. Suspects of a failed probe are the nodes in its chain that nothing else cleared.
3. `answered: true` means the front behind a `proxy` edge responded, so it and everything below
   it work.
4. Causes that explain the most failures rank first; on a tie the lower layer wins.

`checkTarget(node)` returns `node.check` or `meta.Check`/`meta.URL`.

## Other exports

`computeLayout`, `fitCamera` / `sceneBox`, `traverse`, `computeHighlight`, `neighbors`,
`dependencyClosure`, `DEFAULT_THEME`, `resolveTheme`, `DEFAULT_PROFILE`, `resolveProfile`,
`anchorLayerOf`, `reportedStatus`, `profileColors`, `shapeOf`, `typeLabel`, `edgeLabel`,
`structuralKinds`, `proxyKinds`, `NODE_SHAPES`, `computeDiagramLayout`, `toDrawio`, `toSvg`,
`DRAWIO_THEME`. Everything except the two components is available from `stratoscope/core`
without React or three.js; `stratoscope/diagram` adds `Diagram` and needs only React.

## License

MIT
