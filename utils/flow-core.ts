export type RlnFlowResults = { steps: any[]; success: boolean; error: any };

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isPoisonLike(e: unknown): boolean {
  const err = e as { message?: string; code?: unknown } | null;
  const code = typeof err?.code === 'string' ? err.code.toLowerCase() : '';
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  return (
    code.includes('nodestatecorrupted') ||
    msg.includes('poisonerror') ||
    msg.includes('poison error') ||
    msg.includes('node internal state is corrupted')
  );
}

let activeDemoFlow: string | null = null;

export function beginExclusiveFlow(flowName: string) {
  if (activeDemoFlow && activeDemoFlow !== flowName) {
    throw new Error(
      `Flow "${flowName}" blocked: "${activeDemoFlow}" is currently running. Run flows sequentially to avoid RLN/node state conflicts.`
    );
  }
  activeDemoFlow = flowName;
}

export function endExclusiveFlow(flowName: string) {
  if (activeDemoFlow === flowName) {
    activeDemoFlow = null;
  }
}

export function createFlowResults(): {
  results: RlnFlowResults;
  addStep: (step: string, status: string, data?: any, error?: string) => void;
  failFlow: (flowName: string, error: any) => RlnFlowResults;
} {
  const results: RlnFlowResults = { steps: [], success: false, error: null };
  let lastStep: string | null = null;

  const addStep = (step: string, status: string, data?: any, error?: string) => {
    const idx = results.steps.findIndex((s: any) => s.step === step);
    const entry = { step, status, data, error };
    if (idx >= 0) results.steps[idx] = entry;
    else results.steps.push(entry);
    if (status !== 'running') lastStep = step;
    if (status === 'error' || error) {
      console.error(`[flow] ✗ step="${step}" error="${error ?? '(none)'}"`, data ?? null);
    } else if (status === 'running') {
      console.log(`[flow] ▶ step="${step}"`);
    } else {
      console.log(`[flow] ✓ step="${step}"`, data ?? null);
    }
  };

  const failFlow = (flowName: string, error: any): RlnFlowResults => {
    const message = error?.message ?? String(error);
    const stack = error?.stack ?? null;
    console.error(
      `[flow] ✗ FLOW FAILED flowName="${flowName}" lastStep="${lastStep ?? 'none'}" error="${message}"`,
      stack ? `\n${stack}` : ''
    );
    results.success = false;
    results.error = { message, lastStep, stack };
    return results;
  };

  return { results, addStep, failFlow };
}
