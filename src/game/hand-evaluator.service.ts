import { Injectable } from '@nestjs/common';
import { Card, GameType } from './game.types';

interface HandResult {
  rank: number;
  score: number;
  description: string;
  bestFive: Card[];
}

@Injectable()
export class HandEvaluatorService {
  private getCombinations<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    const helper = (start: number, current: T[]) => {
      if (current.length === size) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < array.length; i++) {
        current.push(array[i]);
        helper(i + 1, current);
        current.pop();
      }
    };
    helper(0, []);
    return result;
  }

  private evaluate5CardHand(cards: Card[], gameType: GameType): HandResult {
    const sorted = [...cards].sort((a, b) => b.value - a.value);
    const suits: Record<string, Card[]> = { '♠': [], '♥': [], '♣': [], '♦': [] };
    sorted.forEach(c => suits[c.suit].push(c));

    let isFlush = false;
    let flushScore = 0;
    let flushCards: Card[] = [];
    for (const s in suits) {
      if (suits[s].length >= 5) {
        isFlush = true;
        flushScore = 600 + suits[s][0].value;
        flushCards = suits[s].slice(0, 5);
      }
    }

    const counts: Record<number, number> = {};
    sorted.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1);

    const fours: number[] = [];
    const threes: number[] = [];
    const pairs: number[] = [];
    for (const v in counts) {
      const val = parseInt(v);
      if (counts[v] === 4) fours.push(val);
      if (counts[v] === 3) threes.push(val);
      if (counts[v] === 2) pairs.push(val);
    }
    pairs.sort((a, b) => b - a);
    threes.sort((a, b) => b - a);

    // Check for straight
    const values = [...new Set(sorted.map(c => c.value))].sort((a, b) => b - a);
    let isStraight = false;
    let straightHigh = 0;
    for (let i = 0; i <= values.length - 5; i++) {
      if (values[i] - values[i + 4] === 4) {
        isStraight = true;
        straightHigh = values[i];
        break;
      }
    }
    // Check for wheel (A-2-3-4-5)
    if (!isStraight && values.includes(14) && values.includes(2) && values.includes(3) && values.includes(4) && values.includes(5)) {
      isStraight = true;
      straightHigh = 5;
    }

    // Straight flush
    if (isFlush && isStraight) {
      const flushValues = flushCards.map(c => c.value).sort((a, b) => b - a);
      let isStraightFlush = false;
      for (let i = 0; i <= flushValues.length - 5; i++) {
        if (flushValues[i] - flushValues[i + 4] === 4) {
          isStraightFlush = true;
          if (flushValues[i] === 14) {
            return { rank: 10, score: 1000, description: 'Royal Flush', bestFive: flushCards };
          }
          return { rank: 9, score: 900 + flushValues[i], description: 'Straight Flush', bestFive: flushCards };
        }
      }
    }

    // Short deck: flush beats full house
    if (gameType === 'short_deck') {
      if (fours.length > 0) return { rank: 8, score: 800 + fours[0], description: 'Four of a Kind', bestFive: sorted };
      if (isFlush) return { rank: 7, score: flushScore + 100, description: 'Flush', bestFive: flushCards };
      if (threes.length > 0 && pairs.length > 0) return { rank: 6, score: 700 + threes[0], description: 'Full House', bestFive: sorted };
    } else {
      if (fours.length > 0) return { rank: 8, score: 800 + fours[0], description: 'Four of a Kind', bestFive: sorted };
      if (threes.length > 0 && pairs.length > 0) return { rank: 7, score: 700 + threes[0], description: 'Full House', bestFive: sorted };
      if (isFlush) return { rank: 6, score: flushScore, description: 'Flush', bestFive: flushCards };
    }

    if (isStraight) return { rank: 5, score: 500 + straightHigh, description: 'Straight', bestFive: sorted };
    if (threes.length > 0) return { rank: 4, score: 400 + threes[0], description: 'Three of a Kind', bestFive: sorted };
    if (pairs.length >= 2) return { rank: 3, score: 300 + pairs[0] * 15 + pairs[1], description: 'Two Pair', bestFive: sorted };
    if (pairs.length === 1) return { rank: 2, score: 200 + pairs[0], description: 'Pair', bestFive: sorted };

    return { rank: 1, score: 100 + sorted[0].value, description: `High Card ${sorted[0].rank}`, bestFive: sorted.slice(0, 5) };
  }

  evaluateHand(holeCards: Card[], communityCards: Card[], gameType: GameType): HandResult {
    let bestResult: HandResult = { rank: -1, score: -1, description: '', bestFive: [] };

    if (gameType === 'omaha' || gameType === 'omaha_hi_lo' || gameType === 'courchevel') {
      if (holeCards.length < 2 || communityCards.length < 3) {
        return { rank: 0, score: 0, description: 'Waiting...', bestFive: [] };
      }
      const holeCombos = this.getCombinations(holeCards, 2);
      const boardCombos = this.getCombinations(communityCards, 3);
      holeCombos.forEach(h => {
        boardCombos.forEach(b => {
          const res = this.evaluate5CardHand([...h, ...b], gameType);
          if (res.rank > bestResult.rank || (res.rank === bestResult.rank && res.score > bestResult.score)) {
            bestResult = res;
          }
        });
      });
    } else {
      const all = [...holeCards, ...communityCards];
      if (all.length < 5) {
        return { rank: 0, score: 0, description: 'Waiting...', bestFive: [] };
      }
      this.getCombinations(all, 5).forEach(hand => {
        const res = this.evaluate5CardHand(hand, gameType);
        if (res.rank > bestResult.rank || (res.rank === bestResult.rank && res.score > bestResult.score)) {
          bestResult = res;
        }
      });
    }
    return bestResult;
  }

  evaluateLowHand(holeCards: Card[], communityCards: Card[]): { values: number[]; bestFive: Card[] } | null {
    if (holeCards.length < 2 || communityCards.length < 3) return null;
    const holeCombos = this.getCombinations(holeCards, 2);
    const boardCombos = this.getCombinations(communityCards, 3);
    let best: { values: number[]; bestFive: Card[] } | null = null;

    const better = (a: number[], b: number[]) => {
      for (let i = 0; i < 5; i++) {
        if (a[i] !== b[i]) return a[i] < b[i];
      }
      return false;
    };

    const lowVal = (r: string) => {
      if (r === 'A') return 1;
      if (r === 'K') return 13;
      if (r === 'Q') return 12;
      if (r === 'J') return 11;
      return parseInt(r, 10);
    };

    holeCombos.forEach(h => {
      boardCombos.forEach(b => {
        const five = [...h, ...b];
        const vals = five.map(c => lowVal(c.rank));
        const set = new Set(vals);
        if (set.size !== 5) return;
        if (vals.some(v => v > 8)) return;
        const sorted = [...vals].sort((a, b) => b - a);
        if (!best || better(sorted, best.values)) {
          best = { values: sorted, bestFive: five };
        }
      });
    });
    return best;
  }

  determineWinners(
    players: { odId: string; holeCards: Card[]; folded: boolean }[],
    communityCards: Card[],
    gameType: GameType,
  ): { odId: string; hand: HandResult }[] {
    const activePlayers = players.filter(p => !p.folded);
    if (activePlayers.length === 0) return [];
    if (activePlayers.length === 1) {
      return [{ odId: activePlayers[0].odId, hand: { rank: 0, score: 0, description: 'Last Standing', bestFive: [] } }];
    }

    const evaluated = activePlayers.map(p => ({
      odId: p.odId,
      hand: this.evaluateHand(p.holeCards, communityCards, gameType),
    }));

    const maxScore = Math.max(...evaluated.map(e => e.hand.score));
    return evaluated.filter(e => e.hand.score === maxScore);
  }
}
