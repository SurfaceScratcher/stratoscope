import { profileColors, type DomainProfile } from './profile.js';

export interface Theme {
  background: string;
  /** Colour per node type; unknown types use `defaultNodeColor`. */
  nodeColors: Record<string, string>;
  defaultNodeColor: string;
  /** Colour per edge kind; unknown kinds use `defaultEdgeColor`. */
  edgeColors: Record<string, string>;
  defaultEdgeColor: string;
  /** Highlight of what the selected node needs. */
  needs: string;
  /** Highlight of what fails together with the selected node. */
  affects: string;
  down: string;
  suspect: string;
  plane: string;
  planeOutline: string;
  column: string;
  labelText: string;
  labelBackground: string;
  layerLabel: string;
  columnLabel: string;
  fontFamily: string;
}

// Pastel palette: soft pastels on an ink-violet night
export const DEFAULT_THEME: Theme = {
  background: '#15151f',
  // Colours per node type and edge kind come from the profile; a theme can override them
  nodeColors: {},
  defaultNodeColor: '#e8e6f2',
  edgeColors: {},
  defaultEdgeColor: '#a7a4bb',
  needs: '#aab9f6',
  affects: '#f3a6b6',
  down: '#f0778f',
  suspect: '#f1d68d',
  plane: '#282839',
  planeOutline: '#4a4966',
  column: '#3b3a52',
  labelText: '#e8e6f2',
  labelBackground: 'rgba(21, 21, 31, 0.85)',
  layerLabel: '#a7a4bb',
  columnLabel: '#f7bc94',
  fontFamily: 'system-ui, sans-serif',
};

/**
 * Merges a partial theme into `base` (default DEFAULT_THEME); colour maps are merged key by key.
 * Colours of the profile come between the two: the theme overrides them, they override the base.
 */
export function resolveTheme(theme: Partial<Theme> = {}, profile?: DomainProfile, base: Theme = DEFAULT_THEME): Theme {
  const fromProfile = profile ? profileColors(profile) : { nodeColors: {}, edgeColors: {} };
  return {
    ...base,
    ...theme,
    nodeColors: { ...base.nodeColors, ...fromProfile.nodeColors, ...theme.nodeColors },
    edgeColors: { ...base.edgeColors, ...fromProfile.edgeColors, ...theme.edgeColors },
  };
}
