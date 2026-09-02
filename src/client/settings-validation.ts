/** Parse one bounded integer using caller-owned localized error copy. */
export function integerInRange(
  value: string,
  field: string,
  min: number,
  max: number,
  formatError: (field: string, min: number, max: number) => string,
): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(formatError(field, min, max))
  }
  return parsed
}
