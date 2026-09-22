export function matchesMaintenance(selected: string[], states: (string | false | undefined)[]): boolean {
  return selected.length === 0 || selected.some((value) => states.includes(value));
}
