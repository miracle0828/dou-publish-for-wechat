import esbuild from "esbuild";
import builtins from "builtin-modules";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const output = path.join(process.cwd(), ".render-smoke.cjs");
try {
  await esbuild.build({
    entryPoints: ["tests/render.test.ts"], bundle: true, format: "cjs",
    platform: "node", target: "node18", external: builtins,
    loader: { ".css": "text" }, outfile: output, logLevel: "silent",
  });
  execFileSync(process.execPath, [output], { stdio: "inherit" });
} finally {
  await rm(output, { force: true });
}
