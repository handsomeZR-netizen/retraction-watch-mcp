#!/usr/bin/env node
import { importRetractionWatchData } from "../data/importer.js";
import { getArg, hasFlag, parseArgs } from "./args.js";

const args = parseArgs(process.argv.slice(2));

if (hasFlag(args, "help")) {
  printHelp();
  process.exit(0);
}

const result = await importRetractionWatchData({
  dbPath: getArg(args, "db-path"),
  csvUrl: getArg(args, "csv-url"),
  readmeUrl: getArg(args, "readme-url"),
});

console.log(`Imported ${result.snapshot.rowCount} records`);
console.log(`Database: ${result.dbPath}`);
console.log(`CSV SHA-256: ${result.snapshot.csvSha256}`);
console.log(`Generated on: ${result.snapshot.generatedOn ?? "unknown"}`);
console.log(`Source commit: ${result.snapshot.sourceCommit ?? "unknown"}`);

function printHelp(): void {
  console.log(`Usage: rw-import [options]

Download the public Retraction Watch CSV and build a local SQLite index.

Options:
  --db-path <path>     SQLite database path. Defaults to RW_MCP_DB_PATH or ~/.retraction-watch-mcp/retraction-watch.sqlite.
  --csv-url <url>      Override the Retraction Watch CSV URL.
  --readme-url <url>   Override the Retraction Watch README URL.
  --help              Show this help message.
`);
}
