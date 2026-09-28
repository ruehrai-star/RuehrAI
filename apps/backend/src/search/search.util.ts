/** LIKE/ILIKE contains-pattern. `%`, `_`, and `\` in the input are matched literally. */
export function toContainsPattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}
