import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { execFileSync } from "node:child_process";

const runtimeExts = new Set([
  ".js", ".css", ".json", ".wasm", ".woff2", ".png", ".webp",
  ".jpg", ".svg", ".ico", ".txt",
]);

const tracked = execFileSync("git", ["ls-files", "-z", "src", "public"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => runtimeExts.has(extname(file).toLowerCase()))
  .sort();

const assets = ["./", "./index.html", "./manifest.json", "./sw.js", "./sw-assets.js"]
  .concat(tracked.map((file) => `./${file.replaceAll("\\", "/")}`));

const hash = createHash("sha256");
for (const file of ["index.html", "manifest.json", "sw.js", ...tracked]) {
  hash.update(file);
  hash.update(await readFile(file));
}
const revision = hash.digest("hex").slice(0, 16);
const source = `self.__EBCTF_ASSET_REV = ${JSON.stringify(revision)};\nself.__EBCTF_ASSETS = ${JSON.stringify(assets, null, 2)};\n`;
await writeFile("sw-assets.js", source);
console.log(`sw-assets.js: ${assets.length} files, revision ${revision}`);
