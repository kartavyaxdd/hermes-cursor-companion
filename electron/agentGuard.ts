import type { AgentProposal } from './types';
import type { DesktopTarget } from './desktop';

export function requireApprovedStep(
  proposal: AgentProposal | null, target: DesktopTarget | null, id: string,
  proposedAt: number, now: number, paused: boolean, locked: boolean, excluded: boolean,
): DesktopTarget {
  if (!proposal?.action || proposal.id !== id || !target) throw new Error('This agent step is no longer available.');
  if (now - proposedAt > 30000) throw new Error('This step expired; request a new one.');
  if (paused || locked || excluded) throw new Error('Desktop actions are unavailable right now.');
  return target;
}

export function requireSameTarget(expected: DesktopTarget, actual: DesktopTarget, excluded: boolean): void {
  if (excluded || expected.handle !== actual.handle || expected.process !== actual.process) {
    throw new Error('The target window changed; request a new step.');
  }
}
