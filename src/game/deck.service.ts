import { Injectable } from '@nestjs/common';
import { Card, GameType } from './game.types';

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS_FULL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANKS_SHORT = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANKS_ROYAL = ['10', 'J', 'Q', 'K', 'A'];
const RANKS_MANILA = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

@Injectable()
export class DeckService {
  private getRankValue(rank: string): number {
    if (rank === 'A') return 14;
    if (rank === 'K') return 13;
    if (rank === 'Q') return 12;
    if (rank === 'J') return 11;
    return parseInt(rank);
  }

  private getRanksForGameType(gameType: GameType): string[] {
    switch (gameType) {
      case 'short_deck': return RANKS_SHORT;
      case 'royal': return RANKS_ROYAL;
      case 'manila': return RANKS_MANILA;
      default: return RANKS_FULL;
    }
  }

  createShuffledDeck(gameType: GameType): Card[] {
    const ranks = this.getRanksForGameType(gameType);
    const deck: Card[] = [];

    for (const suit of SUITS) {
      for (const rank of ranks) {
        deck.push({
          suit,
          rank,
          value: this.getRankValue(rank),
          id: `${rank}${suit}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });
      }
    }

    // Fisher-Yates shuffle (cryptographically better than Math.random)
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }

  drawCards(deck: Card[], count: number): { cards: Card[]; remainingDeck: Card[] } {
    if (deck.length < count) {
      throw new Error(`Cannot draw ${count} cards from deck with ${deck.length} cards`);
    }
    const cards = deck.slice(0, count);
    const remainingDeck = deck.slice(count);
    return { cards, remainingDeck };
  }
}
