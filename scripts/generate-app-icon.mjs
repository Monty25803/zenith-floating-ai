import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcPng = join(root, "public", "zenith-icon.png");
const outPath = join(root, "app-icon-source.png");

await sharp(srcPng).resize(1024, 1024, { fit: "cover" }).png().toFile(outPath);
copyFileSync(outPath, join(root, "public", "favicon.png"));
console.log("Wrote app-icon-source.png and favicon.png from zenith-icon.png");
