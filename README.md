# stratoscope

See how things hang together: connected data as stacked 3D layers and 2D diagrams, with
dependency and impact highlighting. Domain profiles make the same core fit infrastructure, CI
pipelines, tasks or organisations.

| Package | |
| --- | --- |
| [`stratoscope`](packages/stratoscope) | The core: data model, domain profiles, layouts, `<Scene>` (3D), `<Diagram>` (2D), SVG and draw.io export, health analysis |
| [`stratoscope-ci`](connectors/ci) | Connector: CI pipelines, workflows and steps from Woodpecker or Drone |

Built on stratoscope: [infra3d](https://github.com/SurfaceScratcher/infra3d), the infrastructure
domain with its self-hosted app.

## Connectors

A connector is anything that writes a topology (see the [JSON schema](packages/stratoscope/topology.schema.json)),
in any language. It ideally carries its domain profile in `topology.profile` and each node's
state in `status`, so stratoscope shows it without further setup. Official connectors live in
[`connectors/`](connectors) until they have a life of their own.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Releases go through [Changesets](https://github.com/changesets/changesets): add a changeset with
`npx changeset`; merging the "Version packages" PR publishes to npm with trusted publishing.

## License

MIT
