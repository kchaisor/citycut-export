export type LonLat = {
  lon: number;
  lat: number;
};

/** East / north meters relative to the cut center. */
export type Pt = [number, number];

export type Ring = Pt[];

export type ModelLayers = {
  buildings: boolean;
  roads: boolean;
  waterGreen: boolean;
  trees: boolean;
};

/**
 * Program of a building. `unclassified` is what remains after the cascade.
 * `mixed_use` is residential together with retail or commercial.
 */
export type BuildingUse =
  | "residential"
  | "commercial"
  | "retail"
  | "mixed_use"
  | "industrial"
  | "civic"
  | "recreation"
  | "outbuilding"
  | "unclassified";

/** Which cascade tier named the use. `none` is unclassified. */
export type TypologySource = "osm_tag" | "zone" | "none";

export type UseTierFailure = {
  tier: "zone";
  /** Short UI line, for example "zones unavailable". */
  message: string;
};

/** One vertical extrusion inside an OSM footprint (CoM clip or OSM-height remainder). */
export type BuildingExtrusionPart = {
  ring: Ring;
  holes: Ring[];
  height: number;
};

export type BuildingFeat = {
  id: number;
  ring: Ring;
  holes: Ring[];
  height: number;
  use: BuildingUse;
  source: TypologySource;
  /**
   * When Better heights (CoM) clips overlaps, 3D and Rhino extrude each part separately.
   * Site plan and exports still use {@link ring} only.
   */
  extrusionParts?: BuildingExtrusionPart[];
};

/** Highway class used for width and asphalt colour. Rail leaves this unset. */
export type RoadGrade = "arterial" | "local" | "path";

export type RoadFeat = {
  id: number;
  line: Ring;
  width: number;
  kind: "road" | "rail";
  grade?: RoadGrade;
};

export type AreaFeat = {
  id: number;
  ring: Ring;
  holes: Ring[];
  kind: "water" | "green";
};

/** Where a tree's height, crown, and trunk came from. */
export type TreeSizeSource = "osm" | "com" | "species" | "default" | "vicmap";

/**
 * Which dataset placed the tree. City of Melbourne wins, then OpenStreetMap,
 * then Vicmap, then canopy infill.
 */
export type TreeTier = "com" | "osm" | "vicmap" | "canopy";

/** Metres. `sizeSource` records which dataset supplied the numbers. */
export type TreeDimensions = {
  height_m: number;
  crown_diameter_m: number;
  trunk_diameter_m: number;
  sizeSource: TreeSizeSource;
};

export type TreeFeat = TreeDimensions & {
  id: number;
  /** East / north meters relative to the cut center. */
  at: Pt;
  /** Copied from OSM when the element already has them. */
  genus?: string;
  species?: string;
  taxon?: string;
  leafType?: string;
  leafCycle?: string;
  /** Massing form chosen from the tags above. */
  archetype?: string;
  /** Dataset that placed this tree. Older fixtures leave this unset. */
  tier?: TreeTier;
};

/**
 * Regular heightfield in the cut's local east/north frame.
 * `heights` are DEM elevations in metres (AHD where the source is the
 * Geoscience Australia lidar; otherwise the Copernicus geoid height).
 * Row 0 is the south edge. Samples include both edges of the square.
 */
export type ContourSourceId = "vicmap-metro" | "vicmap-state" | "dem";

/** One contour polyline in the cut's local east/north frame, clipped to the square. */
export type StoredContour = {
  points: Pt[];
  /** Elevation in metres. Vicmap values are Australian Height Datum. */
  z: number;
};

export type ContourLayer = {
  source: ContourSourceId;
  /** Short label for the Drawing drawer, without the "Contours:" prefix. */
  label: string;
  interval: number;
  lines: StoredContour[];
  attribution: string | null;
  datasetUrl: string | null;
  /** Features returned by the service, before clipping. DEM uses the line count. */
  featureCount: number;
  /** Network time for the Vicmap queries. Zero for a cache hit or the DEM. */
  fetchMs: number;
};

export type TerrainField = {
  cols: number;
  rows: number;
  heights: Float32Array;
  min: number;
  max: number;
  /** Metres between adjacent samples. */
  spacingM: number;
  /** XYZ zoom of the Mapterhorn tiles that were sampled. */
  zoom: number;
  /** Ground metres per source pixel at the cut centre. */
  metresPerPixel: number;
  source: string;
};

export type CityModel = {
  placeLabel: string;
  center: LonLat;
  sideM: number;
  layers: ModelLayers;
  buildings: BuildingFeat[];
  roads: RoadFeat[];
  areas: AreaFeat[];
  trees: TreeFeat[];
  roadKm: number;
  buildingCapHit: boolean;
  /** Set when the combined tree tiers were trimmed to the instance cap. */
  treeCapHit?: boolean;
  sourceNote: string;
  /** Set when the Terrain layer was built. Absent or null keeps the flat ground surface. */
  terrain?: TerrainField | null;
  /** Set when Terrain was requested and the tiles could not be read. */
  terrainError?: string | null;
  /** Vicmap zones skipped after a hard failure. */
  useTierFailures?: UseTierFailure[];
  /** Draw contour lines on the site plan. Vicmap when the cut is in Victoria, otherwise the DEM. */
  contours?: boolean;
  /**
   * Contours for this cut. Set when the Contours layer was on.
   * Absent keeps the older path: marching squares on `terrain` when `contours` is set.
   */
  contourLayer?: ContourLayer | null;
  /** When true, building heights came from City of Melbourne 2023 Building Footprints. */
  comBuildingHeights?: boolean;
};

export type ViewState = {
  lon: number;
  lat: number;
  zoom: number;
};

export type PlaceHit = {
  id: string;
  label: string;
  detail: string;
  lon: number;
  lat: number;
  /** [west, south, east, north] */
  bounds: [number, number, number, number] | null;
};

export type Basemap = "map" | "satellite";

export type UiLayers = ModelLayers & {
  terrain: boolean;
  contours: boolean;
  trees: boolean;
  satellite: boolean;
};
