import type { AgentProposal } from './types';

export const MAX_TASK_STEPS = 8;

// Question/help requests never authorize automatic desktop input.
export function canAutomaticallyAct(input: string): boolean {
  if (/\b(?:do not|don't|dont|without|never)\b|\b(?:show|explain|guide|draw|highlight|point|teach)\b/i.test(input)) return false;
  return /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:perform|click|type|press|open|fill|select|close|switch|save|move|create|rename|set|turn|enter|write|put|navigate)\b/i.test(input.trim());
}

/** Each next step comes from a fresh post-action screenshot, never a queued coordinate list. */
export async function runActionSequence(initial: AgentProposal,
  execute: (id: string) => Promise<AgentProposal>, isCurrent: () => boolean,
  onStep: (proposal: AgentProposal, step: number) => void): Promise<AgentProposal> {
  let proposal = initial;
  for (let step = 1; proposal.action && proposal.automatic && isCurrent(); step++) {
    if (step > MAX_TASK_STEPS) throw new Error('Stopped after eight steps. Review the screen and ask to continue.');
    onStep(proposal, step);
    proposal = await execute(proposal.id);
    if (!isCurrent()) throw new Error('Request stopped.');
  }
  return proposal;
}
