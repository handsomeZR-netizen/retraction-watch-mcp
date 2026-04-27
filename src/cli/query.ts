#!/usr/bin/env node
import { RetractionWatchRepository } from "../data/repository.js";
import { screenPerson } from "../matching/matcher.js";
import { toPublicScreenResult } from "../output.js";
import { getArg, hasFlag, parseArgs, parseCommaList } from "./args.js";

const args = parseArgs(process.argv.slice(2));

if (hasFlag(args, "help")) {
  printHelp();
  process.exit(0);
}

if (!getArg(args, "name")) {
  printHelp();
  process.exit(2);
}

const repository = await RetractionWatchRepository.open(getArg(args, "db-path"));
try {
  const result = await screenPerson(repository, {
    name: getArg(args, "name") ?? "",
    email: getArg(args, "email"),
    institution: getArg(args, "institution"),
    doi: getArg(args, "doi"),
    pmid: getArg(args, "pmid"),
    include_notice_types: parseCommaList(getArg(args, "include-notice-types")),
    limit: getArg(args, "limit") ? Number(getArg(args, "limit")) : undefined,
  });

  console.log(JSON.stringify(toPublicScreenResult(result), null, 2));
} finally {
  repository.close();
}

function printHelp(): void {
  console.log(`Usage: rw-query --name <name> [options]

Query the local Retraction Watch SQLite index.

Options:
  --name <name>                         Person name to screen.
  --institution <institution>           Optional institution or affiliation.
  --email <email>                       Optional email. Only the domain is used as weak evidence.
  --doi <doi>                           Optional original paper DOI or retraction notice DOI.
  --pmid <pmid>                         Optional original paper PMID or retraction notice PMID.
  --include-notice-types <csv>          Comma-separated RetractionNature filter.
  --limit <number>                      Maximum candidates to return.
  --db-path <path>                      SQLite database path.
  --help                                Show this help message.
`);
}
