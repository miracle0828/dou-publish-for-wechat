import { readFile, mkdir, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const releaseDir = path.join(root, "releases", manifest.version);
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) await copyFile(path.join(root, name), path.join(releaseDir, name));
const zipPath = path.join(root, "releases", `dou-publish-for-wechat-${manifest.version}.zip`);
await rm(zipPath, { force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${releaseDir.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`], { stdio: "inherit" });
console.log(zipPath);
