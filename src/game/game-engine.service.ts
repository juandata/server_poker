import { Injectable } from '@nestjs/common';
import { DeckService } from './deck.service';
import { HandEvaluatorService } from './hand-evaluator.service';
import { AntiCheatService } from './anti-cheat.service';
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

@Injectable()
export class GameEngineService {
  private games: Map<string, { state: GameState; deck: Card[] }> = new Map();

  constructor(
    private readonly deckService: DeckService,
    private readonly handEvaluator: HandEvaluatorService,
    private readonly antiCheat: AntiCheatService,
  ) {}

  createGame(
    tableId: string,
    gameType: GameType,
    bettingType: BettingType,
    blinds: { small: number; big: number },
  ): GameState {
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
    this.games.set(tableId, { state, deck: [] });
    return state;
  }

  addPlayer(tableId: string, odId: string, odName: string, buyIn: number, seatIndex: number): boolean {
    const game = this.games.get(tableId);
    if (!game) return false;

    const existingPlayer = game.state.players.find(p => p.odId === odId);
    if (existingPlayer) return false;

    let targetSeatIndex = seatIndex;
    const isSeatTaken = game.state.players.some(p => p.seatIndex === targetSeatIndex);
    if (isSeatTaken) {
      let foundFree = false;
      for (let i = 0; i < 9; i++) {
        const taken = game.state.players.some(p => p.seatIndex === i);
        if (!taken) {
          targetSeatIndex = i;
          foundFree = true;
          break;
        }
      }
      if (!foundFree) return false;
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
    if (!game) return null;
    if (game.state.players.length < 2) return null;

    const { state } = game;

    // Reset for new hand
    state.handNumber++;
    state.stage = 'preflop';
    state.pot = 0;
    state.communityCards = [];
    state.currentHighBet = 0;
    state.raisesThisRound = 0;
    state.lastRaiseAmount = 0;

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
    const game = this.games.get(tableId);
    if (!game) return { success: false, error: 'Game not found' };

    const { state } = game;

    // Anti-cheat validation
    const validation = this.antiCheat.validateAction(state, action);
    if (!validation.valid) {
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
        break;

      case 'check':
        if (toCall > 0) {
          return { success: false, error: 'Cannot check - must call or fold' };
        }
        player.hasActed = true;
        break;

      case 'call':
        const callAmount = Math.min(toCall, player.odStack);
        player.odStack -= callAmount;
        player.currentRoundBet += callAmount;
        player.totalBetThisHand += callAmount;
        state.pot += callAmount;
        player.hasActed = true;
        if (player.odStack === 0) player.isAllIn = true;
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
        break;

      case 'allin':
        const allInAmount = player.odStack;
        const newTotal = player.currentRoundBet + allInAmount;
        player.odStack = 0;
        player.currentRoundBet = newTotal;
        player.totalBetThisHand += allInAmount;
        state.pot += allInAmount;
        player.isAllIn = true;
        player.hasActed = true;

        if (newTotal > state.currentHighBet) {
          const increment = newTotal - state.currentHighBet;
          state.currentHighBet = newTotal;
          state.lastRaiseAmount = increment;
          state.raisesThisRound++;
          state.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.isAllIn) {
              p.hasActed = false;
            }
          });
        }
        break;

      default:
        return { success: false, error: 'Invalid action' };
    }

    state.lastActionTimestamp = Date.now();

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
    const betsEqual = playersToAct.every(p => p.currentRoundBet === state.currentHighBet);

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
    state.stage = 'showdown';
    state.activePlayerIndex = -1;

    const activePlayers = state.players.filter(p => !p.folded);

    if (activePlayers.length === 1) {
      // Single winner - no showdown needed
      activePlayers[0].odStack += state.pot;
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
          player.odStack += winAmount + (i === 0 ? remainder : 0);
        }
      });
    }

    state.pot = 0;
  }

  getClientState(tableId: string, odId: string): ClientGameState | null {
    const game = this.games.get(tableId);
    if (!game) return null;

    const { state } = game;
    const myPlayer = state.players.find(p => p.odId === odId);
    const mySeatIndex = myPlayer?.seatIndex ?? -1;

    const clientPlayers: ClientPlayer[] = state.players.map(p => ({
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
      holeCards: state.stage === 'showdown' && !p.folded ? p.holeCards : undefined,
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
    players: Array<{ odId: string; odName: string; seatIndex: number }>;
  }> {
    const tables: Array<{
      tableId: string;
      gameType: GameType;
      bettingType: BettingType;
      blinds: { small: number; big: number };
      playerCount: number;
      maxPlayers: number;
      players: Array<{ odId: string; odName: string; seatIndex: number }>;
    }> = [];

    for (const [tableId, game] of this.games.entries()) {
      tables.push({
        tableId,
        gameType: game.state.gameType,
        bettingType: game.state.bettingType,
        blinds: game.state.blinds,
        playerCount: game.state.players.length,
        maxPlayers: 9,
        players: game.state.players.map(p => ({
          odId: p.odId,
          odName: p.odName,
          seatIndex: p.seatIndex,
        })),
      });
    }

    return tables;
  }
}
