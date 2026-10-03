import { applyComBuildingHeights } from "./comBuildingHeightsMatch";
import type { BuildingFeat } from "../types";
import type { ComBuildingFootprint } from "./comBuildingHeightsTypes";

export type ComHeightsWorkerRequest = {
  buildings: BuildingFeat[];
  footprints: ComBuildingFootprint[];
};

export type ComHeightsWorkerResponse = {
  buildings: BuildingFeat[];
  updated: number;
};

self.onmessage = (event: MessageEvent<ComHeightsWorkerRequest>) => {
  try {
    const { buildings, footprints } = event.data;
    const result = applyComBuildingHeights(buildings, footprints);
    const payload: ComHeightsWorkerResponse = {
      buildings: result.buildings,
      updated: result.updated,
    };
    self.postMessage(payload);
  } catch {
    const payload: ComHeightsWorkerResponse = {
      buildings: event.data.buildings,
      updated: 0,
    };
    self.postMessage(payload);
  }
};
