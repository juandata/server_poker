import { Injectable } from '@nestjs/common';
import { GameState, PlayerAction, ServerPlayer, Card } from './game.types';

export interface HandHistoryRecord {
  handNumber: number;
  players: Array<Pick<ServerPlayer, 'odId' | 'odName' | 'odStack' | 'holeCards'>>;
  actions: PlayerAction[];
  communityCards: Card[];
  pot: number;
  winners: Array<{ odId: string; amount: number; handRank: string }>;
  timestamp: Date;
}

@Injectable()
export class HandHistoryService {
  private histories: Map<string, HandHistoryRecord[]> = new Map();

  startNewHand(tableId: string, state: GameState): void {
    if (!this.histories.has(tableId)) {
      this.histories.set(tableId, []);
    }

    const players = state.players.map(p => ({
      odId: p.odId,
      odName: p.odName,
      odStack: p.odStack + p.totalBetThisHand, // Record stack before blinds
      holeCards: p.holeCards,
    }));

    const record: HandHistoryRecord = {
      handNumber: state.handNumber,
      players,
      actions: [],
      communityCards: [],
      pot: 0,
      winners: [],
      timestamp: new Date(),
    };

    const tableHistory = this.histories.get(tableId)!;
    // Keep a reasonable limit, e.g., last 100 hands
    if (tableHistory.length > 100) {
      tableHistory.shift();
    }
    tableHistory.push(record);
  }

  logAction(tableId: string, handNumber: number, action: PlayerAction): void {
    const tableHistory = this.histories.get(tableId);
    if (!tableHistory) return;

    const currentHand = tableHistory.find(h => h.handNumber === handNumber);
    if (currentHand) {
      currentHand.actions.push(action);
    }
  }

  logEndHand(tableId: string, state: GameState, winners: Array<{ odId: string; amount: number; handRank: string }>): void {
    const tableHistory = this.histories.get(tableId);
    if (!tableHistory) return;

    const currentHand = tableHistory.find(h => h.handNumber === state.handNumber);
    if (currentHand) {
      currentHand.pot = state.pot;
      currentHand.communityCards = state.communityCards;
      currentHand.winners = winners;
    }
  }

  getHandHistory(tableId: string): HandHistoryRecord[] | undefined {
    return this.histories.get(tableId);
  }
}
