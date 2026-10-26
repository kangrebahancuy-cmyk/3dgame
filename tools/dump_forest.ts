// Writes the generated forest layout + palette to JSON so tools/map_preview.py can render it from the REAL GLBs.
//   tsx tools/dump_forest.ts out.json
import { writeFileSync } from 'node:fs';
import { generateForestLayout } from '../src/world/forest/ForestLayout';
import { FOREST_MAP } from '../src/world/forest/MapConfiguration';
import { FOREST_PALETTE } from '../src/world/forest/NaturePalette';

const out = process.argv[2];
if (!out) throw new Error('usage: tsx tools/dump_forest.ts out.json');
const layout = generateForestLayout(FOREST_MAP);
writeFileSync(out, JSON.stringify({ map: FOREST_MAP, palette: FOREST_PALETTE, objects: layout.objects, solids: layout.solids }));
console.log(`wrote ${out}: ${layout.objects.length} objects, ${layout.solids.length} solids`);
