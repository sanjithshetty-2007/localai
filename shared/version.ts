/** True when latest (e.g. "v1.0.10") is a newer semantic version than current. */
export function newerVersion(latest: string, current: string): boolean {
  const p = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const [a, b] = [p(latest), p(current)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
