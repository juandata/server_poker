// Server-side Game Types - All game logic runs here, NOT on client

export type GameType = 'texas' | 'omaha' | 'omaha_hi_lo' | 'courchevel' | 'royal' | 'short_deck' | 'manila' | 'pineapple' | 'fast_fold';
export type BettingType = 'NL' | 'PL';
export type GameStage = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Card {
  suit: string;
  rank: string;
  value: number;
  id: string;
}

export interface ServerPlayer {
  odId: string;
  odName: string;
  odStack: number;
  holeCards: Card[];
  folded: boolean;
  hasActed: boolean;
  currentRoundBet: number;
  totalBetThisHand: number;
  seatIndex: number;
  isAllIn: boolean;
  isConnected: boolean;
  lastActionTime: number;
}

export interface GameState {
  tableId: string;
  stage: GameStage;
  pot: number;
  communityCards: Card[];
  currentHighBet: number;
  activePlayerIndex: number;
  dealerIndex: number;
  players: ServerPlayer[];
  blinds: { small: number; big: number; ante?: number };
  gameType: GameType;
  bettingType: BettingType;
  raisesThisRound: number;
  lastRaiseAmount: number;
  handNumber: number;
  lastActionTimestamp: number;
  lastAction?: {
    seatIndex: number;
    text: string;
  };
  winners?: Array<{ odId: string; amount: number; handRank: string }>; // Populated at showdown
}

// What we send to each client (sanitized - no opponent hole cards)
export interface ClientGameState {
  tableId: string;
  stage: GameStage;
  pot: number;
  communityCards: Card[];
  currentHighBet: number;
  activePlayerIndex: number;
  dealerIndex: number;
  players: ClientPlayer[];
  blinds: { small: number; big: number };
  myHoleCards: Card[];
  mySeatIndex: number;
  handNumber: number;
  gameType: GameType;
  winners?: Array<{ odId: string; amount: number; handRank: string }>; // Populated at showdown
  lastAction?: {
    seatIndex: number;
    text: string;
  };
}

export interface ClientPlayer {
  odId: string;
  odName: string;
  odStack: number;
  folded: boolean;
  hasActed: boolean;
  currentRoundBet: number;
  seatIndex: number;
  isAllIn: boolean;
  isConnected: boolean;
  // holeCards only visible at showdown or if it's the player's own cards
  holeCards?: Card[];
}

export interface PlayerAction {
  odId: string;
  tableId: string;
  action: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  amount?: number;
  timestamp: number;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  newState?: ClientGameState;
}

export interface HandResult {
  winners: { odId: string; amount: number; hand?: string }[];
  pot: number;
  showdownCards?: { odId: string; cards: Card[] }[];
}

export interface HandHistoryRecord {
  handNumber: number;
  players: Array<Pick<ServerPlayer, 'odId' | 'odName' | 'odStack' | 'holeCards'>>;
  actions: PlayerAction[];
  communityCards: Card[];
  pot: number;
  winners: Array<{ odId: string; amount: number; handRank: string }>;
  timestamp: Date;
}
