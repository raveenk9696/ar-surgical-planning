export function runSteps(...steps: Array<() => void>): void {
  for (const step of steps) {
    try { step(); } catch (error) { console.error('UI update failed', error); }
  }
}
