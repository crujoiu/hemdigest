const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, code) => {
    if (code[0] === "#") {
      const isHex = code[1]?.toLowerCase() === "x";
      const numeric = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);

      return Number.isNaN(numeric) ? entity : String.fromCodePoint(numeric);
    }

    return namedEntities[code] ?? entity;
  });
}
