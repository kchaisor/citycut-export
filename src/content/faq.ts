export const FAQ = [
  {
    q: "What is CityCut?",
    a: "CityCut takes a square of a city and exports it as a simple 3D model and a 2D site plan. It is a study tool for early design work, not a survey.",
  },
  {
    q: "Where does the geometry come from?",
    a: "OpenStreetMap, read through the Overpass API. Place search uses Nominatim. The street map uses OpenFreeMap. The satellite view uses Esri World Imagery. This version does not use lidar — the ground is a flat slab.",
  },
  {
    q: "How are building heights chosen?",
    a: "If OpenStreetMap has a height tag, that value is used (feet are converted). Otherwise building:levels × 3 m. If neither is present, the building is 9 m tall.",
  },
  {
    q: "Which layers are real?",
    a: "Buildings, roads and rail, water and green, and trees are queried and drawn. Terrain and contours can be toggled so the list is honest about what is missing; they are not in the file. Satellite image only changes the basemap preview.",
  },
  {
    q: "How are trees drawn?",
    a: "Trees are OpenStreetMap natural=tree points, tree areas, and tree rows. Each one uses a low-poly massing form chosen from genus, species, taxon, leaf type, and leaf cycle, with a generic broadleaf when those tags do not match. Height uses the height tag when it is present (feet are converted). Crown diameter uses diameter_crown, crown_diameter, or diameter:crown. If only one of height or crown is tagged, the other is estimated so the crown is about 0.6 of the height. If neither is present, the tree is 10 m tall and 6 m across. The 3D view draws one instanced mesh per form.",
  },
  {
    q: "What can I download?",
    a: "A binary glTF (.glb), a Rhino 3DM, and an SVG site plan. Trees, when that layer is on, are in all three: meshes in the glTF and 3DM, circles on the plan. The 3DM is meshes in GDA2020 / MGA metres, Z-up. WGS84 is projected as GDA2020 without a datum shift, about a metre off for site work, and the zone follows the block longitude (west of 144°E is zone 54). DXF, DAE, and JPG are not in this version.",
  },
  {
    q: "How large can the frame be?",
    a: "The side runs from 0.25 km to 1.4 km, which keeps the area under about 2 km². Larger extracts are a poor fit for a live Overpass query in the browser.",
  },
  {
    q: "Who made this?",
    a: "Kelvin Chai, an architect in Melbourne. The map opens on the Melbourne CBD.",
  },
] as const;
