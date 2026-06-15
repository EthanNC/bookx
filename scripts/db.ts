/// <reference path="../sst-env.d.ts" />

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Resource } from "sst/resource";

const commands = ["drop", "init", "seed", "reset"] as const;
type Command = (typeof commands)[number];

const root = join(import.meta.dirname, "..");
const dropFile = join(root, "db/drop.sql");
const schemaFile = join(root, "db/schema.sql");
const dataFile = join(root, "db/data.sql");
const accountingFile = join(root, "db/accounting.sql");

function usage(): never {
  console.error(
    `Usage: sst shell -- bun scripts/db.ts <${commands.join("|")}>`,
  );
  console.error("");
  console.error("  drop   Drop all tables and views");
  console.error("  init   Create tables from db/schema.sql");
  console.error("  seed   Load data from db/data.sql");
  console.error("  reset  drop, init, then seed");
  process.exit(1);
}

function wranglerConfig(): string {
  const config = join(root, ".sst/wrangler", Resource.App.stage, "MyWeb.jsonc");

  if (!existsSync(config)) {
    console.error(`Wrangler config not found: ${config}`);
    console.error("Run `bun sst dev` once so SST generates it.");
    process.exit(1);
  }

  return config;
}

async function executeSql(file: string): Promise<void> {
  const config = wranglerConfig();
  const relativeFile = file.replace(`${root}/`, "./");

  console.log(`Executing ${relativeFile} on MyDatabase`);

  const proc = Bun.spawn(
    [
      "bun",
      "wrangler",
      "d1",
      "execute",
      "MyDatabase",
      "--remote",
      `--file=${file}`,
      `--config=${config}`,
      "-y",
    ],
    {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  if ((await proc.exited) !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}

async function dropTables(): Promise<void> {
  await executeSql(dropFile);
}

async function init(): Promise<void> {
  await executeSql(schemaFile);
}

async function seed(): Promise<void> {
  await executeSql(dataFile);

  // Accounting data is generated on demand by scripts/generate-accounting.ts.
  // Load it if present so AR/AP records seed alongside the core dataset.
  if (existsSync(accountingFile)) {
    await executeSql(accountingFile);
  } else {
    console.log(
      "Skipping db/accounting.sql (run `bun scripts/generate-accounting.ts` to create it)",
    );
  }
}

const command = process.argv[2] as Command | undefined;

if (!command || !commands.includes(command)) {
  usage();
}

switch (command) {
  case "drop":
    await dropTables();
    break;
  case "init":
    await init();
    break;
  case "seed":
    await seed();
    break;
  case "reset":
    await dropTables();
    await init();
    await seed();
    break;
}
