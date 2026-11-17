// Framework-free part of stratoscope: data model, domain profiles, validation, graph traversal,
// layouts, exports and health analysis. Safe to import in Node or a web worker without React or three.js.
export { SCHEMA_VERSION } from './types.js';
export type * from './types.js';
export { validateTopology } from './validate.js';
export type { ValidationResult, ValidateOptions } from './validate.js';
export { computeLayout } from './layout.js';
export type { LayoutOptions, Layout, Vec3 } from './layout.js';
export { fitCamera, sceneBox, DEFAULT_CAMERA_ANGLE } from './camera.js';
export type { CameraAngle, CameraFit, FitOptions, Box } from './camera.js';
export { traverse, computeHighlight, neighbors } from './graph.js';
export type { Reach, Highlight } from './graph.js';
export { shapeOf, nodeTypeSpec, edgeKindSpec, propagates, structuralKinds, proxyKinds, edgeLabel, typeLabel, resolveProfile, anchorLayerOf, profileColors, reportedStatus, DEFAULT_PROFILE, NODE_SHAPES } from './profile.js';
export type { DomainProfile, NodeTypeSpec, EdgeKindSpec, NodeShape } from './profile.js';
export { analyzeHealth, dependencyClosure, checkTarget } from './health.js';
export type { CheckResult, HealthOptions, HealthAnalysis, Cause } from './health.js';
export { DEFAULT_THEME, resolveTheme } from './theme.js';
export type { Theme } from './theme.js';
export { computeDiagramLayout, shortenLabel, DIAGRAM_NODE_RADIUS, DIAGRAM_LABEL_CHARS } from './layout2d.js';
export type { DiagramView, DiagramLayoutOptions, DiagramLayout, DiagramBox, DiagramPoint } from './layout2d.js';
export { toDrawio, DRAWIO_THEME } from './drawio.js';
export type { DrawioOptions } from './drawio.js';
export { toSvg } from './svg.js';
export type { SvgOptions } from './svg.js';
