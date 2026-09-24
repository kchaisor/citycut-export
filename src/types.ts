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

export type BuildingFeat = {
  id: number;
  ring: Ring;
  holes: Ring[];
  height: number;
};

export type RoadFeat = {
  id: number;
  line: Ring;
  width: number;
  kind: "road" | "rail";
};

export type AreaFeat = {
  id: number;
  ring: Ring;
  holes: Ring[];
  kind: "water" | "green";
};

export type TreeFeat = {
  id: number;
  /** East / north meters relative to the cut center. */
  at: Pt;
  height: number;
  crownDiameter: number;
  /** Copied from OSM when the element already has them. */
  genus?: string;
  species?: string;
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
  sourceNote: string;
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
