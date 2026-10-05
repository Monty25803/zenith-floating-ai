import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function patchJson(path, mutator) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  mutator(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

patchJson(join(root, "package.json"), (pkg) => {
  pkg.version = version;
});

patchJson(join(root, "src-tauri", "tauri.conf.json"), (conf) => {
  conf.version = version;
});

const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`,
);
writeFileSync(cargoPath, cargo);

console.log(`Version set to ${version}`);
