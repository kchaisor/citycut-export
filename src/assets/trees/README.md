# Tree archetypes

Low-poly massing forms for Melbourne street and park trees. Each file is glTF 2.0 with an embedded buffer (the same geometry a GLB would carry). The app bundles these files and does not fetch them at runtime.

A form is 1 m tall and half a metre from trunk to the widest part of the crown, with a vertex at the tip. CityCut instances one mesh per form and scales it by the tree’s height and crown diameter.

Regenerate the files after editing `src/lib/treeForms.ts`:

```bash
node --experimental-strip-types scripts/emit-tree-gltf.ts
```

Names are matched in `src/lib/treeMap.json`. Species and taxon win, then genus, then `leaf_type`, then `leaf_cycle`. Anything left uses `generic`.

| id | Represents |
| --- | --- |
| `generic` | Unmapped trees. Rounded crown on a clear trunk. |
| `broadleaf-round` | Dense globe: brush box, lilly pilly, clipped street figs. |
| `broadleaf-spreading` | Wide dome: plane, oak, jacaranda, elm-like spread. |
| `broadleaf-vase` | Vase crown: elms and zelkova. |
| `broadleaf-oval` | Upright oval: ash, birch, magnolia, pin oak. |
| `gum-open` | Tall trunk and a small high crown: spotted gum and many eucalypts. |
| `gum-broad` | Broader high crown: river red gum, lemon-scented gum, angophora. |
| `columnar` | Fastigiate column: Lombardy poplar, hornbeam. |
| `conifer-cone` | Cone: spruce, fir, young pines. |
| `conifer-column` | Flame column: Italian cypress, Norfolk Island pine. |
| `pine-tiered` | Stacked whorls: pines, cedar, bunya. |
| `palm` | Slender trunk and a fan crown: Washingtonia, Livistona. |
| `palm-date` | Thicker trunk and an arching crown: Canary Island date palm. |
| `weeping` | Drooping skirt: willow, peppermint, peppercorn. |
| `small-round` | Small rounded crown: crepe myrtle, olive, flowering gum, prunus. |
| `shrub` | Low mass from the ground: camellia, viburnum, understorey. |
| `open-canopy` | Irregular open crown: acacia, robinia, honey locust, grevillea. |
| `fig-spreading` | Flat wide crown on a short trunk: Moreton Bay fig. |
| `mallee` | Several stems under a low crown. |
| `sheoak` | Fine drooping crown: drooping sheoak and casuarina. |
| `leafless` | Bare branch mass for `leaf_type=leafless`. |
