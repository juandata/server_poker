import { Injectable } from '@nestjs/common';
import { GameState, PlayerAction } from './game.types';

interface ActionLog {
  odId: string;
  tableId: string;
  action: string;
  amount?: number;
  timestamp: number;
  serverTimestamp: number;
  isValid: boolean;
  reason?: string;
}

interface SuspiciousActivity {
  odId: string;
  type: 'timing' | 'pattern' | 'impossible_action' | 'rate_limit';
  description: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high';
}

@Injectable()
export class AntiCheatService {
  private actionLogs: Map<string, ActionLog[]> = new Map();
  private suspiciousActivities: SuspiciousActivity[] = [];
  private actionCounts: Map<string, { count: number; windowStart: number }> = new Map();

  // Rate limiting: max actions per second
  private readonly MAX_ACTIONS_PER_SECOND = 5;
  private readonly RATE_LIMIT_WINDOW_MS = 1000;

  // Timing analysis
  private readonly MIN_ACTION_TIME_MS = 100; // Minimum time to make a decision
  private readonly SUSPICIOUS_FAST_ACTION_MS = 200;

  validateAction(state: GameState, action: PlayerAction): { valid: boolean; reason?: string } {
    const validations = [
      this.validateRateLimit(action),
      this.validateTiming(action),
      this.validatePlayerTurn(state, action),
      this.validateActionType(state, action),
      this.validateBetAmount(state, action),
      this.validatePlayerState(state, action),
    ];

    for (const validation of validations) {
      if (!validation.valid) {
        this.logAction(action, false, validation.reason);
        return validation;
      }
    }

    this.logAction(action, true);
    return { valid: true };
  }

  private validateRateLimit(action: PlayerAction): { valid: boolean; reason?: string } {
    const key = `${action.odId}-${action.tableId}`;
    const now = Date.now();
    const record = this.actionCounts.get(key);

    if (!record || now - record.windowStart > this.RATE_LIMIT_WINDOW_MS) {
      this.actionCounts.set(key, { count: 1, windowStart: now });
      return { valid: true };
    }

    record.count++;
    if (record.count > this.MAX_ACTIONS_PER_SECOND) {
      this.flagSuspicious({
        odId: action.odId,
        type: 'rate_limit',
        description: `Exceeded ${this.MAX_ACTIONS_PER_SECOND} actions per second`,
        timestamp: now,
        severity: 'medium',
      });
      return { valid: false, reason: 'Rate limit exceeded' };
    }

    return { valid: true };
  }

  private validateTiming(action: PlayerAction): { valid: boolean; reason?: string } {
    const key = `${action.odId}-${action.tableId}`;
    const logs = this.actionLogs.get(key) || [];
    const lastAction = logs[logs.length - 1];

    if (lastAction) {
      const timeSinceLastAction = action.timestamp - lastAction.timestamp;

      if (timeSinceLastAction < this.MIN_ACTION_TIME_MS) {
        this.flagSuspicious({
          odId: action.odId,
          type: 'timing',
          description: `Action too fast: ${timeSinceLastAction}ms`,
          timestamp: Date.now(),
          severity: 'high',
        });
        return { valid: false, reason: 'Action too fast - possible automation' };
      }

      if (timeSinceLastAction < this.SUSPICIOUS_FAST_ACTION_MS) {
        this.flagSuspicious({
          odId: action.odId,
          type: 'timing',
          description: `Suspiciously fast action: ${timeSinceLastAction}ms`,
          timestamp: Date.now(),
          severity: 'low',
        });
      }
    }

    return { valid: true };
  }

  private validatePlayerTurn(state: GameState, action: PlayerAction): { valid: boolean; reason?: string } {
    const playerIndex = state.players.findIndex(p => p.odId === action.odId);

    if (playerIndex === -1) {
      return { valid: false, reason: 'Player not in game' };
    }

    if (playerIndex !== state.activePlayerIndex) {
      this.flagSuspicious({
        odId: action.odId,
        type: 'impossible_action',
        description: 'Attempted action out of turn',
        timestamp: Date.now(),
        severity: 'high',
      });
      return { valid: false, reason: 'Not your turn' };
    }

    return { valid: true };
  }

  private validateActionType(state: GameState, action: PlayerAction): { valid: boolean; reason?: string } {
    const player = state.players.find(p => p.odId === action.odId);
    if (!player) return { valid: false, reason: 'Player not found' };

    const toCall = state.currentHighBet - player.currentRoundBet;

    // Can't check if there's money to call
    if (action.action === 'check' && toCall > 0) {
      this.flagSuspicious({
        odId: action.odId,
        type: 'impossible_action',
        description: 'Attempted illegal check when call required',
        timestamp: Date.now(),
        severity: 'medium',
      });
      return { valid: false, reason: 'Cannot check - must call or fold' };
    }

    return { valid: true };
  }

  private validateBetAmount(state: GameState, action: PlayerAction): { valid: boolean; reason?: string } {
    if (action.action !== 'raise' || !action.amount) {
      return { valid: true };
    }

    const player = state.players.find(p => p.odId === action.odId);
    if (!player) return { valid: false, reason: 'Player not found' };

    // Can't bet more than you have
    const maxBet = player.odStack + player.currentRoundBet;
    if (action.amount > maxBet) {
      this.flagSuspicious({
        odId: action.odId,
        type: 'impossible_action',
        description: `Attempted to bet ${action.amount} with only ${player.odStack} in stack`,
        timestamp: Date.now(),
        severity: 'high',
      });
      return { valid: false, reason: 'Insufficient funds' };
    }

    // Raise must be higher than current bet
    if (action.amount <= state.currentHighBet) {
      return { valid: false, reason: 'Raise must be higher than current bet' };
    }

    // Minimum raise validation
    const raiseIncrement = action.amount - state.currentHighBet;
    if (state.lastRaiseAmount > 0 && raiseIncrement < state.lastRaiseAmount) {
      return { valid: false, reason: `Minimum raise is ${state.lastRaiseAmount}` };
    }

    // Pot limit validation
    if (state.bettingType === 'PL') {
      const toCall = state.currentHighBet - player.currentRoundBet;
      const maxRaise = state.pot + state.currentHighBet + toCall;
      if (action.amount > maxRaise) {
        return { valid: false, reason: `Pot limit: max raise is ${maxRaise}` };
      }
    }

    return { valid: true };
  }

  private validatePlayerState(state: GameState, action: PlayerAction): { valid: boolean; reason?: string } {
    const player = state.players.find(p => p.odId === action.odId);
    if (!player) return { valid: false, reason: 'Player not found' };

    if (player.folded) {
      this.flagSuspicious({
        odId: action.odId,
        type: 'impossible_action',
        description: 'Attempted action after folding',
        timestamp: Date.now(),
        severity: 'high',
      });
      return { valid: false, reason: 'Already folded' };
    }

    if (player.isAllIn) {
      return { valid: false, reason: 'Already all-in' };
    }

    return { valid: true };
  }

  private logAction(action: PlayerAction, isValid: boolean, reason?: string): void {
    const key = `${action.odId}-${action.tableId}`;
    const logs = this.actionLogs.get(key) || [];

    logs.push({
      odId: action.odId,
      tableId: action.tableId,
      action: action.action,
      amount: action.amount,
      timestamp: action.timestamp,
      serverTimestamp: Date.now(),
      isValid,
      reason,
    });

    // Keep only last 100 actions per player
    if (logs.length > 100) {
      logs.shift();
    }

    this.actionLogs.set(key, logs);
  }

  private flagSuspicious(activity: SuspiciousActivity): void {
    this.suspiciousActivities.push(activity);
    console.warn(`[ANTI-CHEAT] Suspicious activity: ${activity.type} - ${activity.description} (Player: ${activity.odId})`);

    // Keep only last 1000 suspicious activities
    if (this.suspiciousActivities.length > 1000) {
      this.suspiciousActivities.shift();
    }
  }

  getSuspiciousActivities(odId?: string): SuspiciousActivity[] {
    if (odId) {
      return this.suspiciousActivities.filter(a => a.odId === odId);
    }
    return [...this.suspiciousActivities];
  }

  getPlayerActionLogs(odId: string, tableId: string): ActionLog[] {
    const key = `${odId}-${tableId}`;
    return this.actionLogs.get(key) || [];
  }

  clearPlayerData(odId: string, tableId: string): void {
    const key = `${odId}-${tableId}`;
    this.actionLogs.delete(key);
    this.actionCounts.delete(key);
  }
}
