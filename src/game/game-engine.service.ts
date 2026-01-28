import { Injectable } from '@nestjs/common';
import { DeckService } from './deck.service';
import { HandEvaluatorService } from './hand-evaluator.service';
import { AntiCheatService } from './anti-cheat.service';
import { HandHistoryService } from './hand-history.service';
import {
  Card,
  GameState,
  GameType,
  BettingType,
  ServerPlayer,
  PlayerAction,
  ActionResult,
  ClientGameState,
  ClientPlayer,
  GameStage,
} from './game.types';

const MAX_RAISES_PER_ROUND = 4;
const ACTION_TIMEOUT_MS = 30000; // 30 seconds to act

// Max players per game type
const MAX_PLAYERS_BY_GAME: Record<GameType, number> = {
  texas: 9,
  short_deck: 9,
  royal: 6,
  omaha: 6,
  omaha_hi_lo: 6,
  courchevel: 6,
  manila: 6,
  pineapple: 6,
  fast_fold: 6,
};

// Stake definitions for auto-creating default tables
interface StakeDefinition {
  label: string;
  blinds: { small: number; big: number };
  bettingType: BettingType;
}

const STAKES_BY_GAME: Record<GameType, StakeDefinition[]> = {
  texas: [
    { label: 'NL2', blinds: { small: 0.01, big: 0.02 }, bettingType: 'NL' },
    { label: 'NL5', blinds: { small: 0.02, big: 0.05 }, bettingType: 'NL' },
    { label: 'NL10', blinds: { small: 0.05, big: 0.10 }, bettingType: 'NL' },
    { label: 'NL25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'NL' },
    { label: 'NL50', blinds: { small: 0.25, big: 0.50 }, bettingType: 'NL' },
    { label: 'NL100', blinds: { small: 0.50, big: 1.00 }, bettingType: 'NL' },
    { label: 'NL200', blinds: { small: 1, big: 2 }, bettingType: 'NL' },
  ],
  omaha: [
    { label: 'PLO2', blinds: { small: 0.01, big: 0.02 }, bettingType: 'PL' },
    { label: 'PLO5', blinds: { small: 0.02, big: 0.05 }, bettingType: 'PL' },
    { label: 'PLO10', blinds: { small: 0.05, big: 0.10 }, bettingType: 'PL' },
    { label: 'PLO25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'PL' },
    { label: 'PLO50', blinds: { small: 0.25, big: 0.50 }, bettingType: 'PL' },
    { label: 'PLO100', blinds: { small: 0.50, big: 1.00 }, bettingType: 'PL' },
  ],
  omaha_hi_lo: [
    { label: 'PLO8-2', blinds: { small: 0.01, big: 0.02 }, bettingType: 'PL' },
    { label: 'PLO8-10', blinds: { small: 0.05, big: 0.10 }, bettingType: 'PL' },
    { label: 'PLO8-25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'PL' },
  ],
  short_deck: [
    { label: 'NL10', blinds: { small: 0.05, big: 0.10 }, bettingType: 'NL' },
    { label: 'NL25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'NL' },
    { label: 'NL50', blinds: { small: 0.25, big: 0.50 }, bettingType: 'NL' },
  ],
  courchevel: [
    { label: 'PL10', blinds: { small: 0.05, big: 0.10 }, bettingType: 'PL' },
    { label: 'PL25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'PL' },
  ],
  royal: [
    { label: 'NL25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'NL' },
    { label: 'NL50', blinds: { small: 0.25, big: 0.50 }, bettingType: 'NL' },
  ],
  manila: [
    { label: 'NL25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'NL' },
    { label: 'NL50', blinds: { small: 0.25, big: 0.50 }, bettingType: 'NL' },
  ],
  pineapple: [
    { label: 'NL25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'NL' },
    { label: 'NL50', blinds: { small: 0.25, big: 0.50 }, bettingType: 'NL' },
  ],
  fast_fold: [
    { label: 'NL10', blinds: { small: 0.05, big: 0.10 }, bettingType: 'NL' },
    { label: 'NL25', blinds: { small: 0.10, big: 0.25 }, bettingType: 'NL' },
  ],
};

@Injectable()
export class GameEngineService {
  private games: Map<string, { state: GameState; deck: Card[]; maxPlayers: number; stakeLabel: string; isSystemTable: boolean }> = new Map();
  private tableCounters: Map<string, number> = new Map(); // Track table numbers per stake

  constructor(
    private readonly deckService: DeckService,
    private readonly handEvaluator: HandEvaluatorService,
    private readonly antiCheat: AntiCheatService,
    private readonly handHistoryService: HandHistoryService,
  ) {
    // Create default tables on service initialization
    this.createDefaultTables();
  }

  // Create one default table per stake for each game type
  private createDefaultTables(): void {
    console.log('[GameEngine] Creating default tables...');
    for (const [gameType, stakes] of Object.entries(STAKES_BY_GAME)) {
      for (const stake of stakes) {
        const tableId = this.generateTableId(gameType as GameType, stake.label, true);
        this.createGame(tableId, gameType as GameType, stake.bettingType, stake.blinds, stake.label, true);
        console.log(`[GameEngine] Created default table: ${tableId}`);
      }
    }
  }

  // Generate a unique table ID
  private generateTableId(gameType: GameType, stakeLabel: string, isSystemTable: boolean): string {
    const key = `${gameType}-${stakeLabel}`;
    const counter = (this.tableCounters.get(key) || 0) + 1;
    this.tableCounters.set(key, counter);
    const prefix = isSystemTable ? 'sys' : 'usr';
    return `${prefix}-${gameType}-${stakeLabel}-${counter}`;
  }

  // Check if we need to create a new system table after a player joins
  private ensureAvailableTable(gameType: GameType, stakeLabel: string, blinds: { small: number; big: number }, bettingType: BettingType): void {
    // Find all tables for this game type and stake
    const tablesForStake = Array.from(this.games.entries())
      .filter(([_, game]) =>
        game.state.gameType === gameType &&
        game.stakeLabel === stakeLabel
      );

    // Check if there's at least one table with available seats
    const hasAvailableTable = tablesForStake.some(([_, game]) =>
      game.state.players.length < game.maxPlayers
    );

    // If no available tables, create a new system table
    if (!hasAvailableTable) {
      const newTableId = this.generateTableId(gameType, stakeLabel, true);
      this.createGame(newTableId, gameType, bettingType, blinds, stakeLabel, true);
      console.log(`[GameEngine] Auto-created new table (previous full): ${newTableId}`);
    }
  }

  createGame(
    tableId: string,
    gameType: GameType,
    bettingType: BettingType,
    blinds: { small: number; big: number },
    stakeLabel: string = '',
    isSystemTable: boolean = false,
  ): GameState {
    const maxPlayers = MAX_PLAYERS_BY_GAME[gameType] || 9;
    const state: GameState = {
      tableId,
      stage: 'waiting',
      pot: 0,
      communityCards: [],
      currentHighBet: 0,
      activePlayerIndex: -1,
      dealerIndex: 0,
      players: [],
      blinds,
      gameType,
      bettingType,
      raisesThisRound: 0,
      lastRaiseAmount: 0,
      handNumber: 0,
      lastActionTimestamp: Date.now(),
    };
    this.games.set(tableId, { state, deck: [], maxPlayers, stakeLabel, isSystemTable });
    return state;
  }

  addPlayer(tableId: string, odId: string, odName: string, buyIn: number, seatIndex: number): boolean {
    const game = this.games.get(tableId);
    if (!game) {
      console.log(`[GameEngine] addPlayer: game not found for ${tableId}`);
      return false;
    }

    const existingPlayer = game.state.players.find(p => p.odId === odId);

    // If player exists but is disconnected, reconnect them
    if (existingPlayer) {
      if (!existingPlayer.isConnected) {
        console.log(`[GameEngine] addPlayer: Reconnecting player ${odId} at seat ${existingPlayer.seatIndex}`);
        existingPlayer.isConnected = true;
        existingPlayer.lastActionTime = Date.now();
        return true;
      }
      console.log(`[GameEngine] addPlayer: Player ${odId} already connected`);
      return false;
    }

    // Check if table is full
    if (game.state.players.length >= game.maxPlayers) {
      console.log(`[GameEngine] addPlayer: Table full (${game.state.players.length}/${game.maxPlayers})`);
      return false;
    }

    let targetSeatIndex = seatIndex;
    const isSeatTaken = game.state.players.some(p => p.seatIndex === targetSeatIndex);
    if (isSeatTaken) {
      console.log(`[GameEngine] addPlayer: Seat ${targetSeatIndex} is taken, finding free seat`);
      let foundFree = false;
      for (let i = 0; i < game.maxPlayers; i++) {
        const taken = game.state.players.some(p => p.seatIndex === i);
        if (!taken) {
          targetSeatIndex = i;
          foundFree = true;
          console.log(`[GameEngine] addPlayer: Found free seat ${i}`);
          break;
        }
      }
      if (!foundFree) {
        console.log(`[GameEngine] addPlayer: No free seats found`);
        return false;
      }
    }

    const player: ServerPlayer = {
      odId,
      odName,
      odStack: buyIn,
      holeCards: [],
      folded: false,
      hasActed: false,
      currentRoundBet: 0,
      totalBetThisHand: 0,
      seatIndex: targetSeatIndex,
      isAllIn: false,
      isConnected: true,
      lastActionTime: Date.now(),
    };

    game.state.players.push(player);
    game.state.players.sort((a, b) => a.seatIndex - b.seatIndex);

    // After adding player, ensure there's still an available table for this stake
    this.ensureAvailableTable(
      game.state.gameType,
      game.stakeLabel,
      game.state.blinds,
      game.state.bettingType,
    );

    // If we now have enough players, start the hand
    if (game.state.players.length >= 2 && game.state.stage === 'waiting') {
      console.log(`[GameEngine] addPlayer: 2+ players present, auto-starting hand`);
      this.startHand(tableId);
    } else {
      console.log(`[GameEngine] addPlayer: Not auto-starting. Players: ${game.state.players.length}, Stage: ${game.state.stage}`);
    }

    return true;
  }

  removePlayer(tableId: string, odId: string): boolean {
    const game = this.games.get(tableId);
    if (!game) return false;

    const idx = game.state.players.findIndex(p => p.odId === odId);
    if (idx === -1) return false;

    // If game is in progress, mark as folded instead of removing
    if (game.state.stage !== 'waiting') {
      game.state.players[idx].folded = true;
      game.state.players[idx].isConnected = false;
    } else {
      game.state.players.splice(idx, 1);
    }
    return true;
  }

  startHand(tableId: string): GameState | null {
    const game = this.games.get(tableId);
    if (!game) {
      console.log(`[GameEngine] startHand: game not found for ${tableId}`);
      return null;
    }

    // Clean up disconnected players and players with no stack before starting
    const initialPlayerCount = game.state.players.length;
    game.state.players = game.state.players.filter(p => p.isConnected && p.odStack > 0);
    if (game.state.players.length < initialPlayerCount) {
      console.log(`[GameEngine] startHand: Removed ${initialPlayerCount - game.state.players.length} disconnected/broke players`);
    }

    if (game.state.players.length < 2) {
      console.log(`[GameEngine] startHand: not enough players (${game.state.players.length})`);
      game.state.stage = 'waiting';
      return null;
    }

    const { state } = game;

    console.log(`[GameEngine] startHand: Starting hand #${state.handNumber + 1} for table ${tableId}`);
    console.log(`[GameEngine] startHand: Players:`, state.players.map(p => ({ name: p.odName, stack: p.odStack })));

    // Reset for new hand
    state.handNumber++;
    state.stage = 'preflop';
    state.pot = 0;
    state.communityCards = [];
    state.currentHighBet = 0;
    state.raisesThisRound = 0;
    state.raisesThisRound = 0;
    state.lastRaiseAmount = 0;
    delete state.lastAction; // Reset lastAction logic

    // Create and shuffle new deck
    game.deck = this.deckService.createShuffledDeck(state.gameType);

    // Move dealer button
    state.dealerIndex = (state.dealerIndex + 1) % state.players.length;

    // Determine cards per player
    let cardsPerPlayer = 2;
    if (state.gameType === 'omaha' || state.gameType === 'omaha_hi_lo') cardsPerPlayer = 4;
    if (state.gameType === 'courchevel') cardsPerPlayer = 5;
    if (state.gameType === 'pineapple') cardsPerPlayer = 3;

    // Deal hole cards to each player
    for (const player of state.players) {
      player.folded = false;
      player.hasActed = false;
      player.currentRoundBet = 0;
      player.totalBetThisHand = 0;
      player.isAllIn = false;
      player.holeCards = [];

      const { cards, remainingDeck } = this.deckService.drawCards(game.deck, cardsPerPlayer);
      player.holeCards = cards;
      game.deck = remainingDeck;
    }

    this.handHistoryService.startNewHand(tableId, state);

    // Post blinds
    const sbIndex = (state.dealerIndex + 1) % state.players.length;
    const bbIndex = (state.dealerIndex + 2) % state.players.length;

    this.postBlind(state, sbIndex, state.blinds.small);
    this.postBlind(state, bbIndex, state.blinds.big);
    state.currentHighBet = state.blinds.big;

    // First to act is UTG (after BB)
    state.activePlayerIndex = (bbIndex + 1) % state.players.length;
    this.skipFoldedOrAllIn(state);

    state.lastActionTimestamp = Date.now();

    // For Courchevel, deal first community card
    if (state.gameType === 'courchevel') {
      const { cards, remainingDeck } = this.deckService.drawCards(game.deck, 1);
      state.communityCards = cards;
      game.deck = remainingDeck;
    }

    console.log(`[GameEngine] startHand: Hand started. Stage: ${state.stage}, ActivePlayer: ${state.activePlayerIndex}, Pot: ${state.pot}`);

    return state;
  }

  private postBlind(state: GameState, playerIndex: number, amount: number): void {
    const player = state.players[playerIndex];
    const actualAmount = Math.min(amount, player.odStack);
    player.odStack -= actualAmount;
    player.currentRoundBet = actualAmount;
    player.totalBetThisHand = actualAmount;
    state.pot += actualAmount;
    if (player.odStack === 0) player.isAllIn = true;
  }

  private skipFoldedOrAllIn(state: GameState): void {
    let loops = 0;
    while (
      (state.players[state.activePlayerIndex].folded ||
        state.players[state.activePlayerIndex].isAllIn) &&
      loops < state.players.length
    ) {
      state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
      loops++;
    }
  }

  processAction(tableId: string, action: PlayerAction): ActionResult {
    console.log(`[GameEngine] processAction: ${action.action} from ${action.odId}, amount: ${action.amount || 0}`);

    const game = this.games.get(tableId);
    if (!game) return { success: false, error: 'Game not found' };

    const { state } = game;
    console.log(`[GameEngine] processAction: Stage: ${state.stage}, ActivePlayer: ${state.activePlayerIndex}, Pot: ${state.pot}`);

    // Anti-cheat validation
    const validation = this.antiCheat.validateAction(state, action);
    if (!validation.valid) {
      console.log(`[GameEngine] processAction: Action rejected - ${validation.reason}`);
      return { success: false, error: validation.reason || 'Action rejected' };
    }
    const playerIndex = state.players.findIndex(p => p.odId === action.odId);

    if (playerIndex === -1) {
      return { success: false, error: 'Player not in game' };
    }

    if (playerIndex !== state.activePlayerIndex) {
      return { success: false, error: 'Not your turn' };
    }

    if (state.stage === 'waiting' || state.stage === 'showdown') {
      return { success: false, error: 'Hand not in progress' };
    }

    const player = state.players[playerIndex];
    if (player.folded || player.isAllIn) {
      return { success: false, error: 'Cannot act - folded or all-in' };
    }

    const toCall = state.currentHighBet - player.currentRoundBet;

    // Validate and execute action
    switch (action.action) {
      case 'fold':
        player.folded = true;
        player.hasActed = true;
        state.lastAction = { seatIndex: playerIndex, text: 'FOLD' };
        break;

      case 'check':
        if (toCall > 0) {
          return { success: false, error: 'Cannot check - must call or fold' };
        }
        player.hasActed = true;
        state.lastAction = { seatIndex: playerIndex, text: 'CHECK' };
        break;

      case 'call':
        const callAmount = Math.min(toCall, player.odStack);
        player.odStack -= callAmount;
        player.currentRoundBet += callAmount;
        player.totalBetThisHand += callAmount;
        state.pot += callAmount;
        player.hasActed = true;
        if (player.odStack === 0) player.isAllIn = true;
        state.lastAction = { seatIndex: playerIndex, text: 'CALL' };
        break;

      case 'raise':
        const raiseTotal = action.amount || 0;

        // Validate raise amount
        if (raiseTotal <= state.currentHighBet) {
          return { success: false, error: 'Raise must be higher than current bet' };
        }

        // Minimum raise validation
        const raiseIncrement = raiseTotal - state.currentHighBet;
        if (state.lastRaiseAmount > 0 && raiseIncrement < state.lastRaiseAmount) {
          return { success: false, error: `Minimum raise is ${state.lastRaiseAmount}` };
        }

        // Max raises per round
        if (state.raisesThisRound >= MAX_RAISES_PER_ROUND) {
          return { success: false, error: 'Maximum raises reached this round' };
        }

        // Pot limit validation
        if (state.bettingType === 'PL') {
          const maxRaise = state.pot + state.currentHighBet + toCall;
          if (raiseTotal > maxRaise) {
            return { success: false, error: `Pot limit: max raise is ${maxRaise}` };
          }
        }

        const contribution = raiseTotal - player.currentRoundBet;
        const actualContribution = Math.min(contribution, player.odStack);
        player.odStack -= actualContribution;
        player.currentRoundBet += actualContribution;
        player.totalBetThisHand += actualContribution;
        state.pot += actualContribution;

        state.currentHighBet = player.currentRoundBet;
        state.lastRaiseAmount = raiseIncrement;
        state.raisesThisRound++;

        // Reset hasActed for other players
        state.players.forEach((p, i) => {
          if (i !== playerIndex && !p.folded && !p.isAllIn) {
            p.hasActed = false;
          }
        });

        player.hasActed = true;
        if (player.odStack === 0) player.isAllIn = true;

        // Use RERAISE if this is not the first raise of the round
        const actionText = state.raisesThisRound > 1 ? `RERAISE ${raiseTotal}` : `RAISE ${raiseTotal}`;
        state.lastAction = { seatIndex: playerIndex, text: actionText };
        break;

      case 'allin':
        const allInAmount = player.odStack;
        // Raise logic if amount > currentHighBet
        if (player.currentRoundBet + allInAmount > state.currentHighBet) {
          const actualRaise = (player.currentRoundBet + allInAmount) - state.currentHighBet;
          state.lastRaiseAmount = actualRaise; // Even if less than min raise, valid for all-in
          state.currentHighBet = player.currentRoundBet + allInAmount;
          state.raisesThisRound++; // Count as raise? Usually yes.
          // Reset hasActed
          state.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.isAllIn) {
              p.hasActed = false;
            }
          });
        }

        player.odStack = 0;
        player.currentRoundBet += allInAmount;
        player.totalBetThisHand += allInAmount;
        state.pot += allInAmount;
        player.isAllIn = true;
        player.hasActed = true;
        state.lastAction = { seatIndex: playerIndex, text: 'ALL IN' };
        break;


      default:
        return { success: false, error: 'Invalid action' };
    }

    state.lastActionTimestamp = Date.now();
    this.handHistoryService.logAction(tableId, state.handNumber, action);

    // Check for hand end conditions and advance
    this.advanceGame(game);

    return { success: true };
  }

  private advanceGame(game: { state: GameState; deck: Card[] }): void {
    const { state } = game;

    // Check if only one player remains
    const activePlayers = state.players.filter(p => !p.folded);
    if (activePlayers.length === 1) {
      this.endHand(game);
      return;
    }

    // Check if betting round is complete
    const playersToAct = state.players.filter(p => !p.folded && !p.isAllIn);
    const allActed = playersToAct.every(p => p.hasActed);
    const betsEqual = playersToAct.every(p => Math.abs(p.currentRoundBet - state.currentHighBet) < 0.01);

    if (allActed && betsEqual) {
      // Check if all but one are all-in (runout)
      const notAllIn = state.players.filter(p => !p.folded && !p.isAllIn);
      if (notAllIn.length <= 1) {
        // Run out remaining cards
        this.runOutCards(game);
        return;
      }

      // Advance to next stage
      this.advanceStage(game);
    } else {
      // Move to next player
      state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
      this.skipFoldedOrAllIn(state);
    }
  }

  private advanceStage(game: { state: GameState; deck: Card[] }): void {
    const { state } = game;

    // Reset for new betting round
    state.players.forEach(p => {
      p.currentRoundBet = 0;
      p.hasActed = p.folded || p.isAllIn;
    });
    state.currentHighBet = 0;
    state.raisesThisRound = 0;
    state.lastRaiseAmount = 0;

    switch (state.stage) {
      case 'preflop':
        state.stage = 'flop';
        const flopCards = state.gameType === 'courchevel' ? 2 : 3;
        const { cards: flop, remainingDeck: afterFlop } = this.deckService.drawCards(game.deck, flopCards);
        if (state.gameType === 'courchevel') {
          state.communityCards.push(...flop);
        } else {
          state.communityCards = flop;
        }
        game.deck = afterFlop;
        break;

      case 'flop':
        state.stage = 'turn';
        const { cards: turn, remainingDeck: afterTurn } = this.deckService.drawCards(game.deck, 1);
        state.communityCards.push(...turn);
        game.deck = afterTurn;
        break;

      case 'turn':
        state.stage = 'river';
        const { cards: river, remainingDeck: afterRiver } = this.deckService.drawCards(game.deck, 1);
        state.communityCards.push(...river);
        game.deck = afterRiver;
        break;

      case 'river':
        this.endHand(game);
        return;
    }

    // Set first to act (first active player after dealer)
    state.activePlayerIndex = (state.dealerIndex + 1) % state.players.length;
    this.skipFoldedOrAllIn(state);
  }

  private runOutCards(game: { state: GameState; deck: Card[] }): void {
    const { state } = game;

    while (state.stage !== 'showdown' && state.communityCards.length < 5) {
      if (state.stage === 'preflop') {
        const { cards, remainingDeck } = this.deckService.drawCards(game.deck, 3);
        state.communityCards.push(...cards);
        game.deck = remainingDeck;
        state.stage = 'flop';
      } else {
        const { cards, remainingDeck } = this.deckService.drawCards(game.deck, 1);
        state.communityCards.push(...cards);
        game.deck = remainingDeck;
        if (state.stage === 'flop') state.stage = 'turn';
        else if (state.stage === 'turn') state.stage = 'river';
        else state.stage = 'showdown';
      }
    }

    this.endHand(game);
  }

  private endHand(game: { state: GameState; deck: Card[] }): void {
    const { state } = game;
    console.log(`[GameEngine] endHand: Ending hand #${state.handNumber} for table ${state.tableId}`);
    state.stage = 'showdown';
    state.activePlayerIndex = -1;

    const activePlayers = state.players.filter(p => !p.folded);
    let handWinners: Array<{ odId: string; amount: number; handRank: string; winningCards?: Card[] }> = [];

    if (activePlayers.length === 1) {
      // Single winner - no showdown needed
      const winnerPlayer = activePlayers[0];
      winnerPlayer.odStack += state.pot;
      handWinners = [{ odId: winnerPlayer.odId, amount: state.pot, handRank: 'unopposed' }];
    } else {
      // Determine winners
      const winners = this.handEvaluator.determineWinners(
        activePlayers.map(p => ({ odId: p.odId, holeCards: p.holeCards, folded: p.folded })),
        state.communityCards,
        state.gameType,
      );

      const winAmount = Math.floor(state.pot / winners.length);
      const remainder = state.pot - winAmount * winners.length;

      winners.forEach((w, i) => {
        const player = state.players.find(p => p.odId === w.odId);
        if (player) {
          const playerWinAmount = winAmount + (i === 0 ? remainder : 0);
          player.odStack += playerWinAmount;
          handWinners.push({
            odId: w.odId,
            amount: playerWinAmount,
            handRank: w.hand.description,
            winningCards: w.hand.bestFive
          });
        }
      });
    }

    this.handHistoryService.logEndHand(game.state.tableId, state, handWinners);
    state.pot = 0;

    // Save winners to state for client display
    state.winners = handWinners;

    // Cleanup: Remove disconnected players and players with 0 stack
    state.players = state.players.filter(p => p.isConnected && p.odStack > 0);

    // If less than 2 players remain, go back to waiting
    if (state.players.length < 2) {
      console.log(`[GameEngine] endHand: Not enough players (${state.players.length}), setting stage to waiting`);
      state.stage = 'waiting';
      state.winners = undefined; // Clear winners when going to waiting
    }
    // NOTE: Auto-start of next hand is handled by the Gateway (which can broadcast state)
  }

  getClientState(tableId: string, odId: string): ClientGameState | null {
    const game = this.games.get(tableId);
    if (!game) return null;

    const { state } = game;
    const myPlayer = state.players.find(p => p.odId === odId);
    const mySeatIndex = myPlayer?.seatIndex ?? -1;

    const clientPlayers: ClientPlayer[] = state.players
      .filter(p => p.isConnected) // Only send connected players
      .map(p => ({
        odId: p.odId,
        odName: p.odName,
        odStack: p.odStack,
        folded: p.folded,
        hasActed: p.hasActed,
        currentRoundBet: p.currentRoundBet,
        seatIndex: p.seatIndex,
        isAllIn: p.isAllIn,
        isConnected: p.isConnected,
        // Only show hole cards at showdown or if it's the player's own cards
        holeCards: state.stage === 'showdown' && !p.folded ? p.holeCards : [],
      }));

    return {
      tableId: state.tableId,
      stage: state.stage,
      pot: state.pot,
      communityCards: state.communityCards,
      currentHighBet: state.currentHighBet,
      activePlayerIndex: state.activePlayerIndex,
      dealerIndex: state.dealerIndex,
      players: clientPlayers,
      blinds: state.blinds,
      myHoleCards: myPlayer?.holeCards || [],
      mySeatIndex,
      handNumber: state.handNumber,
      gameType: state.gameType,
      winners: state.winners,
      lastAction: state.lastAction,
    };
  }

  getGame(tableId: string): { state: GameState; deck: Card[] } | undefined {
    return this.games.get(tableId);
  }

  deleteGame(tableId: string): boolean {
    return this.games.delete(tableId);
  }

  changeSeat(tableId: string, odId: string, newSeatIndex: number): boolean {
    const game = this.games.get(tableId);
    if (!game) return false;

    // Cannot change seats during an active hand
    if (game.state.stage !== 'waiting' && game.state.stage !== 'showdown') {
      return false;
    }

    // Verify the new seat is free
    const seatTaken = game.state.players.find(p => p.seatIndex === newSeatIndex);
    if (seatTaken) return false;

    // Find the player and change their seat
    const player = game.state.players.find(p => p.odId === odId);
    if (!player) return false;

    player.seatIndex = newSeatIndex;
    game.state.players.sort((a, b) => a.seatIndex - b.seatIndex);
    return true;
  }

  getAllTables(): Array<{
    tableId: string;
    gameType: GameType;
    bettingType: BettingType;
    blinds: { small: number; big: number };
    playerCount: number;
    maxPlayers: number;
    stakeLabel: string;
    isSystemTable: boolean;
    players: Array<{ odId: string; odName: string; seatIndex: number }>;
  }> {
    const tables: Array<{
      tableId: string;
      gameType: GameType;
      bettingType: BettingType;
      blinds: { small: number; big: number };
      playerCount: number;
      maxPlayers: number;
      stakeLabel: string;
      isSystemTable: boolean;
      players: Array<{ odId: string; odName: string; seatIndex: number }>;
    }> = [];

    for (const [tableId, game] of this.games.entries()) {
      tables.push({
        tableId,
        gameType: game.state.gameType,
        bettingType: game.state.bettingType,
        blinds: game.state.blinds,
        playerCount: game.state.players.filter(p => p.isConnected).length,
        maxPlayers: game.maxPlayers,
        stakeLabel: game.stakeLabel,
        isSystemTable: game.isSystemTable,
        players: game.state.players
          .filter(p => p.isConnected)
          .map(p => ({
            odId: p.odId,
            odName: p.odName,
            seatIndex: p.seatIndex,
          })),
      });
    }

    return tables;
  }

  // Create a user-requested table
  createUserTable(
    gameType: GameType,
    stakeLabel: string,
    blinds: { small: number; big: number },
    bettingType: BettingType,
  ): string {
    const tableId = this.generateTableId(gameType, stakeLabel, false);
    this.createGame(tableId, gameType, bettingType, blinds, stakeLabel, false);
    console.log(`[GameEngine] User created table: ${tableId}`);
    return tableId;
  }

  // Get max players for a game type
  getMaxPlayers(gameType: GameType): number {
    return MAX_PLAYERS_BY_GAME[gameType] || 9;
  }
}
