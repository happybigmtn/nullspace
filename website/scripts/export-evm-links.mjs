import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

const convexUrl = required("CONVEX_URL");
const serviceToken = required("CONVEX_SERVICE_TOKEN");
const outputPath = process.env.OUTPUT_PATH ?? path.resolve("data", "player-evm-links.json");
const pageSize = Number(process.env.PAGE_SIZE ?? "200");

const client = new ConvexHttpClient(convexUrl, {
  skipConvexDeploymentUrlCheck: true,
});

let cursor = null;
let isDone = false;
const links = [];

while (!isDone) {
  const result = await client.query(api.evm.listEvmLinks, {
    serviceToken,
    paginationOpts: { cursor, numItems: pageSize },
  });
  links.push(...result.links);
  cursor = result.continueCursor;
  isDone = result.isDone;
}

const payload = {
  generatedAt: new Date().toISOString(),
  total: links.length,
  links,
};

const outDir = path.dirname(outputPath);
if (outDir && outDir !== ".") {
  fs.mkdirSync(outDir, { recursive: true });
}
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

console.log(`Wrote ${links.length} links to ${outputPath}`);
