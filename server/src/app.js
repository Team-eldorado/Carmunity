import { createContext } from './core.js';
import { createAccounts } from './services/accounts.js';
import { createDelegation } from './services/delegation.js';
import { createCredits } from './services/credits.js';
import { createAudit } from './services/audit.js';
import { createVehicleState } from './services/vehicleState.js';
import { createNeutral } from './services/neutral.js';
import { createVacancy } from './services/vacancy.js';
import { createMoveRequests } from './services/moveRequests.js';
import { createTrunk } from './services/trunk.js';
import { createVirtualAgent } from './services/virtualAgent.js';
import { createCompact } from './services/compact.js';
import { createProximity } from './services/proximity.js';

/** 서비스 묶음. 서로를 늦게 참조하도록 deps를 함수로 넘긴다. */
export function createApp(opts = {}) {
  const ctx = createContext(opts);
  const s = {};
  const deps = {
    accounts: () => s.accounts,
    delegation: () => s.delegation,
    credits: () => s.credits,
    audit: () => s.audit,
    vehicleState: () => s.vehicleState,
    neutral: () => s.neutral,
    vacancy: () => s.vacancy,
    move: () => s.move,
    trunk: () => s.trunk,
    compact: () => s.compact,
    proximity: () => s.proximity,
  };
  s.proximity = createProximity(ctx, deps);
  s.accounts = createAccounts(ctx, deps);
  s.delegation = createDelegation(ctx, deps);
  s.credits = createCredits(ctx, deps);
  s.audit = createAudit(ctx, deps);
  s.vehicleState = createVehicleState(ctx, deps);
  s.neutral = createNeutral(ctx, deps);
  s.vacancy = createVacancy(ctx, deps);
  s.move = createMoveRequests(ctx, deps);
  s.trunk = createTrunk(ctx, deps);
  s.agent = createVirtualAgent(ctx, deps);
  s.compact = createCompact(ctx, deps);
  return { ctx, ...s };
}
