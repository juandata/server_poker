import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Verification document types
export type VerificationDocType = 'id_front' | 'id_back' | 'selfie' | 'proof_address';
export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'not_uploaded';

// Rakeback tier levels
export type RakebackTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

// Payment method types
export type PaymentMethodType = 'nequi' | 'bancolombia' | 'daviplata' | 'pse' | 'crypto';

@Schema({ _id: false })
export class VerificationDocument {
  @Prop({ required: true, enum: ['id_front', 'id_back', 'selfie', 'proof_address'] })
  type: VerificationDocType;

  @Prop({ required: true, enum: ['pending', 'approved', 'rejected', 'not_uploaded'], default: 'not_uploaded' })
  status: VerificationStatus;

  @Prop()
  fileUrl?: string;

  @Prop()
  uploadedAt?: Date;

  @Prop()
  reviewedAt?: Date;

  @Prop()
  rejectionReason?: string;
}

@Schema({ _id: false })
export class PaymentMethod {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true, enum: ['nequi', 'bancolombia', 'daviplata', 'pse', 'crypto'] })
  type: PaymentMethodType;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  details: string; // e.g., last 4 digits of account

  @Prop({ default: false })
  isDefault: boolean;

  @Prop()
  addedAt?: Date;
}

@Schema({ _id: false })
export class RakebackStats {
  @Prop({ default: 0 })
  totalRakeGenerated: number;

  @Prop({ default: 0 })
  currentMonthRake: number;

  @Prop({ default: 0 })
  rakebackEarned: number;

  @Prop({ default: 0 })
  rakebackPending: number;

  @Prop({ default: 20 })
  rakebackPercentage: number;

  @Prop({ default: 'bronze', enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'] })
  tier: RakebackTier;

  @Prop({ default: 0 })
  nextTierProgress: number;

  @Prop()
  lastCalculatedAt?: Date;
}

@Schema({ _id: false })
export class WalletBalance {
  @Prop({ default: 0 })
  real: number; // Real money balance (withdrawable)

  @Prop({ default: 0 })
  bonus: number; // Bonus balance (wagering required)

  @Prop({ default: 0 })
  wageringRequired: number; // Amount that still needs to be wagered

  @Prop({ default: 0 })
  wageringProgress: number; // Amount already wagered towards requirement
}

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop()
  displayName?: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  phoneNumber?: string;

  @Prop({ type: Object })
  providers?: { googleId?: string; googleRefreshToken?: string };

  // Wallet/Balance
  @Prop({ type: WalletBalance, default: () => ({}) })
  wallet: WalletBalance;

  // Payment Methods
  @Prop({ type: [PaymentMethod], default: [] })
  paymentMethods: PaymentMethod[];

  // Verification
  @Prop({ type: [VerificationDocument], default: () => [
    { type: 'id_front', status: 'not_uploaded' },
    { type: 'id_back', status: 'not_uploaded' },
    { type: 'selfie', status: 'not_uploaded' },
    { type: 'proof_address', status: 'not_uploaded' },
  ]})
  verificationDocs: VerificationDocument[];

  @Prop({ default: false })
  isVerified: boolean;

  // Rakeback
  @Prop({ type: RakebackStats, default: () => ({}) })
  rakeback: RakebackStats;

  // Account status
  @Prop({ default: 'active', enum: ['active', 'suspended', 'banned'] })
  status: string;

  @Prop()
  lastLoginAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
