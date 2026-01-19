import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TransactionType = 'deposit' | 'withdrawal' | 'bonus' | 'rake' | 'rakeback' | 'freeroll_prize' | 'tournament_entry' | 'tournament_prize';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

@Schema({ timestamps: true })
export class Transaction extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['deposit', 'withdrawal', 'bonus', 'rake', 'rakeback', 'freeroll_prize', 'tournament_entry', 'tournament_prize'] })
  type: TransactionType;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, enum: ['pending', 'completed', 'failed', 'cancelled'], default: 'pending' })
  status: TransactionStatus;

  @Prop({ required: true })
  method: string; // e.g., 'Nequi', 'Bancolombia', 'Sistema', etc.

  @Prop()
  description?: string;

  @Prop()
  reference?: string; // External reference ID for deposits/withdrawals

  // For bonus/freeroll prizes with wagering requirements
  @Prop({ default: 0 })
  wageringMultiplier: number; // e.g., 5 for 5x wagering requirement

  @Prop({ default: false })
  wageringCompleted: boolean;

  // Balance snapshot after transaction
  @Prop()
  balanceAfter?: number;

  // Related game/tournament info
  @Prop()
  gameId?: string;

  @Prop()
  tournamentId?: string;

  @Prop()
  handId?: string;

  // Admin notes
  @Prop()
  adminNotes?: string;

  @Prop()
  processedBy?: string;

  @Prop()
  processedAt?: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// Create indexes
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1 });
TransactionSchema.index({ createdAt: -1 });
