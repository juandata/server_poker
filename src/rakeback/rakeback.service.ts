import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, RakebackTier } from '../users/schemas/user.schema';
import { RakeContribution } from '../users/schemas/rake-contribution.schema';
import { Transaction } from '../users/schemas/transaction.schema';

/**
 * Rakeback Tier Configuration
 *
 * Tier thresholds are based on monthly rake generated:
 * - Bronze: $0 - $49.99 → 20% rakeback
 * - Silver: $50 - $99.99 → 25% rakeback
 * - Gold: $100 - $499.99 → 30% rakeback
 * - Platinum: $500 - $999.99 → 35% rakeback
 * - Diamond: $1000+ → 40% rakeback
 */
const TIER_CONFIG: Record<RakebackTier, { minRake: number; percentage: number }> = {
  bronze: { minRake: 0, percentage: 20 },
  silver: { minRake: 50, percentage: 25 },
  gold: { minRake: 100, percentage: 30 },
  platinum: { minRake: 500, percentage: 35 },
  diamond: { minRake: 1000, percentage: 40 },
};

const TIER_ORDER: RakebackTier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

@Injectable()
export class RakebackService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(RakeContribution.name) private rakeContributionModel: Model<RakeContribution>,
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
  ) {}

  /**
   * Calculate the tier based on monthly rake
   */
  calculateTier(monthlyRake: number): { tier: RakebackTier; percentage: number; nextTierProgress: number } {
    let currentTier: RakebackTier = 'bronze';
    let currentPercentage = TIER_CONFIG.bronze.percentage;

    for (const tier of TIER_ORDER) {
      if (monthlyRake >= TIER_CONFIG[tier].minRake) {
        currentTier = tier;
        currentPercentage = TIER_CONFIG[tier].percentage;
      }
    }

    // Calculate progress to next tier
    const currentTierIndex = TIER_ORDER.indexOf(currentTier);
    let nextTierProgress = 100;

    if (currentTierIndex < TIER_ORDER.length - 1) {
      const nextTier = TIER_ORDER[currentTierIndex + 1];
      const currentMin = TIER_CONFIG[currentTier].minRake;
      const nextMin = TIER_CONFIG[nextTier].minRake;
      nextTierProgress = Math.min(100, ((monthlyRake - currentMin) / (nextMin - currentMin)) * 100);
    }

    return { tier: currentTier, percentage: currentPercentage, nextTierProgress };
  }

  /**
   * Record a rake contribution from a hand (Weighted Contributed Rake method)
   */
  async recordRakeContribution(params: {
    userId: string;
    handId: string;
    gameType: string;
    stakes: string;
    tableId: string;
    totalPot: number;
    playerContribution: number;
    totalRake: number;
  }): Promise<RakeContribution> {
    const user = await this.userModel.findById(params.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Calculate player's share of rake using WCR
    const playerRakeShare = (params.playerContribution / params.totalPot) * params.totalRake;

    // Get current rakeback percentage
    const rakebackPercentage = user.rakeback?.rakebackPercentage || TIER_CONFIG.bronze.percentage;
    const rakebackAmount = playerRakeShare * (rakebackPercentage / 100);

    // Create rake contribution record
    const contribution = new this.rakeContributionModel({
      userId: new Types.ObjectId(params.userId),
      handId: params.handId,
      gameType: params.gameType,
      stakes: params.stakes,
      tableId: params.tableId,
      totalPot: params.totalPot,
      playerContribution: params.playerContribution,
      totalRake: params.totalRake,
      playerRakeShare,
      rakebackPercentage,
      rakebackAmount,
      playedAt: new Date(),
      rakebackCredited: false,
    });

    await contribution.save();

    // Update user's rakeback stats
    await this.updateUserRakebackStats(params.userId, playerRakeShare, rakebackAmount);

    return contribution;
  }

  /**
   * Update user's rakeback statistics
   */
  private async updateUserRakebackStats(userId: string, rakeAmount: number, rakebackAmount: number): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) return;

    // Get current month's total rake
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyRake = await this.rakeContributionModel.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          playedAt: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalRake: { $sum: '$playerRakeShare' },
        },
      },
    ]);

    const currentMonthRake = monthlyRake[0]?.totalRake || 0;
    const { tier, percentage, nextTierProgress } = this.calculateTier(currentMonthRake);

    // Update user stats
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: {
        'rakeback.totalRakeGenerated': rakeAmount,
        'rakeback.rakebackPending': rakebackAmount,
      },
      $set: {
        'rakeback.currentMonthRake': currentMonthRake,
        'rakeback.tier': tier,
        'rakeback.rakebackPercentage': percentage,
        'rakeback.nextTierProgress': nextTierProgress,
        'rakeback.lastCalculatedAt': new Date(),
      },
    });
  }

  /**
   * Claim pending rakeback for a user
   */
  async claimRakeback(userId: string): Promise<{ amount: number; transaction: Transaction }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const pendingAmount = user.rakeback?.rakebackPending || 0;
    if (pendingAmount <= 0) {
      throw new Error('No rakeback available to claim');
    }

    // Create transaction
    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'rakeback',
      amount: pendingAmount,
      status: 'completed',
      method: 'Sistema',
      description: `Rakeback reclamado - Nivel ${user.rakeback?.tier || 'bronze'}`,
      balanceAfter: (user.wallet?.real || 0) + pendingAmount,
    });

    await transaction.save();

    // Update user balance and reset pending rakeback
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: {
        'wallet.real': pendingAmount,
        'rakeback.rakebackEarned': pendingAmount,
      },
      $set: {
        'rakeback.rakebackPending': 0,
      },
    });

    // Mark rake contributions as credited
    await this.rakeContributionModel.updateMany(
      { userId: new Types.ObjectId(userId), rakebackCredited: false },
      { rakebackCredited: true, rakebackCreditedAt: new Date() },
    );

    return { amount: pendingAmount, transaction };
  }

  /**
   * Get rakeback statistics for a user
   */
  async getRakebackStats(userId: string): Promise<{
    totalRakeGenerated: number;
    currentMonthRake: number;
    rakebackEarned: number;
    rakebackPending: number;
    rakebackPercentage: number;
    tier: RakebackTier;
    nextTierProgress: number;
    recentContributions: RakeContribution[];
  }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const recentContributions = await this.rakeContributionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ playedAt: -1 })
      .limit(20)
      .exec();

    return {
      totalRakeGenerated: user.rakeback?.totalRakeGenerated || 0,
      currentMonthRake: user.rakeback?.currentMonthRake || 0,
      rakebackEarned: user.rakeback?.rakebackEarned || 0,
      rakebackPending: user.rakeback?.rakebackPending || 0,
      rakebackPercentage: user.rakeback?.rakebackPercentage || 20,
      tier: user.rakeback?.tier || 'bronze',
      nextTierProgress: user.rakeback?.nextTierProgress || 0,
      recentContributions,
    };
  }

  /**
   * Process freeroll prize with wagering requirement
   */
  async creditFreerollPrize(userId: string, amount: number, tournamentId: string, wageringMultiplier: number = 5): Promise<Transaction> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const wageringRequired = amount * wageringMultiplier;

    // Create transaction
    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'freeroll_prize',
      amount,
      status: 'completed',
      method: 'Freeroll',
      description: `Premio de Freeroll - Req. apuesta: ${wageringMultiplier}x`,
      tournamentId,
      wageringMultiplier,
      wageringCompleted: false,
      balanceAfter: (user.wallet?.bonus || 0) + amount,
    });

    await transaction.save();

    // Add to bonus balance with wagering requirement
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: {
        'wallet.bonus': amount,
        'wallet.wageringRequired': wageringRequired,
      },
    });

    return transaction;
  }

  /**
   * Track wagering progress when player plays a hand
   */
  async trackWageringProgress(userId: string, amountWagered: number): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) return;

    const currentRequired = user.wallet?.wageringRequired || 0;
    const currentProgress = user.wallet?.wageringProgress || 0;
    const bonusBalance = user.wallet?.bonus || 0;

    if (currentRequired <= 0 || bonusBalance <= 0) return;

    const newProgress = currentProgress + amountWagered;

    if (newProgress >= currentRequired) {
      // Wagering completed - convert bonus to real money
      await this.userModel.findByIdAndUpdate(userId, {
        $inc: {
          'wallet.real': bonusBalance,
        },
        $set: {
          'wallet.bonus': 0,
          'wallet.wageringRequired': 0,
          'wallet.wageringProgress': 0,
        },
      });

      // Mark related transactions as wagering completed
      await this.transactionModel.updateMany(
        { userId: new Types.ObjectId(userId), wageringCompleted: false, wageringMultiplier: { $gt: 0 } },
        { wageringCompleted: true },
      );
    } else {
      // Update progress
      await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          'wallet.wageringProgress': newProgress,
        },
      });
    }
  }

  /**
   * Monthly rake reset (run via cron job)
   */
  async resetMonthlyRake(): Promise<void> {
    await this.userModel.updateMany(
      {},
      {
        $set: {
          'rakeback.currentMonthRake': 0,
          'rakeback.nextTierProgress': 0,
        },
      },
    );
  }
}
