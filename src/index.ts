#!/usr/bin/env node
import { runMcpServer } from "./mcp/server.js";
import { getArg, hasFlag, parseArgs } from "./cli/args.js";
import { loadPolicy } from "./policy.js";

const args = parseArgs(process.argv.slice(2));

if (hasFlag(args, "help")) {
  console.log(`Usage: rw-mcp [options]

Start the Retraction Watch MCP server over stdio.

Options:
  --db-path <path>   SQLite database path. Defaults to RW_MCP_DB_PATH or ~/.retraction-watch-mcp/retraction-watch.sqlite.
  --policy <value>   Policy name (balanced, strict) or path to a policy JSON file.
  --strict           Shortcut for --policy strict.
  --help            Show this help message.
`);
  process.exit(0);
}

try {
  await runMcpServer({
    dbPath: getArg(args, "db-path"),
    policy: await loadPolicy(getArg(args, "policy"), hasFlag(args, "strict")),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
