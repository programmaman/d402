const consumed = new Set<string>();

export function consumeOnce(key: string): boolean {
  if (consumed.has(key)) {
    return false;
  }

  consumed.add(key);
  return true;
}
