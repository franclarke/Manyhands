import fs from "node:fs/promises";
import JSZip from "jszip";

const pptxPath = process.argv[2];

if (!pptxPath) {
  throw new Error("Usage: node add-fade-transitions.mjs <deck.pptx>");
}

const bytes = await fs.readFile(pptxPath);
const zip = await JSZip.loadAsync(bytes);
const slidePaths = Object.keys(zip.files)
  .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  .sort((left, right) => {
    const leftNumber = Number(left.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    const rightNumber = Number(right.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    return leftNumber - rightNumber;
  });

for (const slidePath of slidePaths) {
  let xml = await zip.file(slidePath).async("string");
  xml = xml.replace(/<p:transition\b[\s\S]*?<\/p:transition>/g, "");
  const transition = '<p:transition spd="fast" advClick="1"><p:fade/></p:transition>';
  xml = xml.replace("</p:sld>", `${transition}</p:sld>`);
  zip.file(slidePath, xml);
}

const updated = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});

await fs.writeFile(pptxPath, updated);
console.log(`Added fade transitions to ${slidePaths.length} slides: ${pptxPath}`);
