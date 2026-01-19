import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * RakeContribution Schema
 *
 * Tracks individual rake contributions using the Weighted Contributed Rake (WCR) method.
 *
 * WCR Formula:
 * Player's Rake Contribution = (Player's Contribution to Pot / Total Pot) × Total Rake
 *
 * Example:
 * - Pot is $100, Rake is $3
 * - Player A contributed $60, Player B contributed $40
 * - Player A's WCR = ($60 / $100) × $3 = $1.80
 * - Player B's WCR = ($40 / $100) × $3 = $1.20
 */
@Schema({ timestamps: true })
export class RakeContribution extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  handId: string;

  @Prop({ required: true })
  gameType: string; // 'texas', 'omaha', etc.

  @Prop({ required: true })
  stakes: string; // '$0.50/$1', etc.

  @Prop({ required: true })
  tableId: string;

  // Pot and contribution details
  @Prop({ required: true })
  totalPot: number;

  @Prop({ required: true })
  playerContribution: number; // How much this player put into the pot

  @Prop({ required: true })
  totalRake: number; // Total rake taken from the hand

  @Prop({ required: true })
  playerRakeShare: number; // Calculated WCR for this player

  // Rakeback calculation
  @Prop({ required: true })
  rakebackPercentage: number; // Player's rakeback % at time of hand

  @Prop({ required: true })
  rakebackAmount: number; // playerRakeShare × rakebackPercentage

  // Timestamps for aggregation
  @Prop({ required: true, index: true })
  playedAt: Date;

  @Prop({ default: false })
  rakebackCredited: boolean;

  @Prop()
  rakebackCreditedAt?: Date;
}

export const RakeContributionSchema = SchemaFactory.createForClass(RakeContribution);

// Create indexes for efficient querying
RakeContributionSchema.index({ userId: 1, playedAt: -1 });
RakeContributionSchema.index({ userId: 1, rakebackCredited: 1 });
RakeContributionSchema.index({ playedAt: 1 }); // For monthly aggregations
