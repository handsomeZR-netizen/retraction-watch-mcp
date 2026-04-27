export interface ParsedArgs {
  values: Record<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = normalizeKey(rawKey);

    if (inlineValue !== undefined) {
      values[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      index += 1;
    } else {
      flags.add(key);
      values[key] = "true";
    }
  }

  return { values, flags };
}

export function getArg(args: ParsedArgs, key: string): string | undefined {
  return args.values[normalizeKey(key)];
}

export function hasFlag(args: ParsedArgs, key: string): boolean {
  return args.flags.has(normalizeKey(key)) || args.values[normalizeKey(key)] === "true";
}

export function parseCommaList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizeKey(key: string): string {
  return key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
