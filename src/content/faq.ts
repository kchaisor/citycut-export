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
    a: "Buildings, roads and rail, and water and green are queried and drawn. Terrain, contours, and trees can be toggled so the list is honest about what is missing; they are not in the file. Satellite image only changes the basemap preview.",
  },
  {
    q: "What can I download?",
    a: "A binary glTF (.glb) and an SVG site plan. DXF, DAE, 3DM, and JPG are not in this version, so there is no placeholder download for them.",
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
