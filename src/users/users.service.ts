import { Injectable, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, PaymentMethod, VerificationDocType } from './schemas/user.schema';
import { Transaction } from './schemas/transaction.schema';
import { randomUUID } from 'crypto';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
  ) {}

  async onModuleInit() {
    try {
      await this.userModel.collection.dropIndex('name_1');
    } catch {
      // ignore if index does not exist
    }
  }

  async create(email: string, passwordHash: string, displayName?: string) {
    const user = new this.userModel({ email, passwordHash, displayName });
    return user.save();
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email }).exec();
  }

  async findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  // ============= TRANSACTIONS =============

  async getTransactions(userId: string, limit: number = 50) {
    return this.transactionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async createDeposit(userId: string, amount: number, paymentMethodId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const paymentMethod = user.paymentMethods?.find(pm => pm.id === paymentMethodId);
    if (!paymentMethod) {
      throw new BadRequestException('Payment method not found');
    }

    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'deposit',
      amount,
      status: 'pending',
      method: paymentMethod.name,
      description: `Depósito vía ${paymentMethod.name}`,
      reference: `DEP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });

    await transaction.save();

    return {
      success: true,
      transaction,
      message: 'Depósito en proceso. Serás notificado cuando se acredite.',
    };
  }

  async createWithdrawal(userId: string, amount: number, paymentMethodId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const realBalance = user.wallet?.real || 0;
    if (amount > realBalance) {
      throw new BadRequestException('Insufficient balance');
    }

    const paymentMethod = user.paymentMethods?.find(pm => pm.id === paymentMethodId);
    if (!paymentMethod) {
      throw new BadRequestException('Payment method not found');
    }

    // Check if user is verified for withdrawals
    if (!user.isVerified) {
      throw new BadRequestException('Account must be verified to withdraw');
    }

    // Deduct from balance immediately (pending withdrawal)
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { 'wallet.real': -amount },
    });

    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'withdrawal',
      amount,
      status: 'pending',
      method: paymentMethod.name,
      description: `Retiro a ${paymentMethod.name}`,
      reference: `WTH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      balanceAfter: realBalance - amount,
    });

    await transaction.save();

    return {
      success: true,
      transaction,
      message: 'Retiro en proceso. El tiempo estimado es de 24-48 horas.',
    };
  }

  // ============= PAYMENT METHODS =============

  async addPaymentMethod(
    userId: string,
    data: { type: string; name: string; details: string },
  ) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const newMethod: PaymentMethod = {
      id: randomUUID(),
      type: data.type as any,
      name: data.name,
      details: data.details,
      isDefault: (user.paymentMethods?.length || 0) === 0, // First method is default
      addedAt: new Date(),
    };

    await this.userModel.findByIdAndUpdate(userId, {
      $push: { paymentMethods: newMethod },
    });

    return { success: true, paymentMethod: newMethod };
  }

  async removePaymentMethod(userId: string, methodId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const method = user.paymentMethods?.find(pm => pm.id === methodId);
    if (!method) {
      throw new BadRequestException('Payment method not found');
    }

    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { paymentMethods: { id: methodId } },
    });

    // If removed method was default, set another as default
    if (method.isDefault && user.paymentMethods && user.paymentMethods.length > 1) {
      const remaining = user.paymentMethods.filter(pm => pm.id !== methodId);
      if (remaining.length > 0) {
        await this.userModel.updateOne(
          { _id: userId, 'paymentMethods.id': remaining[0].id },
          { $set: { 'paymentMethods.$.isDefault': true } },
        );
      }
    }

    return { success: true };
  }

  async setDefaultPaymentMethod(userId: string, methodId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Unset all defaults
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { 'paymentMethods.$[].isDefault': false } },
    );

    // Set new default
    await this.userModel.updateOne(
      { _id: userId, 'paymentMethods.id': methodId },
      { $set: { 'paymentMethods.$.isDefault': true } },
    );

    return { success: true };
  }

  // ============= VERIFICATION =============

  async uploadVerificationDocument(userId: string, type: VerificationDocType, fileUrl: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userModel.updateOne(
      { _id: userId, 'verificationDocs.type': type },
      {
        $set: {
          'verificationDocs.$.status': 'pending',
          'verificationDocs.$.fileUrl': fileUrl,
          'verificationDocs.$.uploadedAt': new Date(),
          'verificationDocs.$.rejectionReason': null,
        },
      },
    );

    return { success: true, message: 'Documento subido. En revisión (24-48 horas).' };
  }

  async getVerificationStatus(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const docs = user.verificationDocs || [];
    const allApproved = docs.length === 4 && docs.every(d => d.status === 'approved');

    return {
      isVerified: user.isVerified,
      documents: docs,
      allApproved,
      missingDocs: docs.filter(d => d.status === 'not_uploaded').map(d => d.type),
      pendingReview: docs.filter(d => d.status === 'pending').map(d => d.type),
      rejected: docs.filter(d => d.status === 'rejected'),
    };
  }

  // Admin method to approve/reject verification documents
  async reviewVerificationDocument(
    userId: string,
    type: VerificationDocType,
    approved: boolean,
    rejectionReason?: string,
  ) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userModel.updateOne(
      { _id: userId, 'verificationDocs.type': type },
      {
        $set: {
          'verificationDocs.$.status': approved ? 'approved' : 'rejected',
          'verificationDocs.$.reviewedAt': new Date(),
          'verificationDocs.$.rejectionReason': approved ? null : rejectionReason,
        },
      },
    );

    // Check if all docs are approved
    const updatedUser = await this.findById(userId);
    const allApproved = updatedUser?.verificationDocs?.every(d => d.status === 'approved');

    if (allApproved) {
      await this.userModel.findByIdAndUpdate(userId, { isVerified: true });
    }

    return { success: true };
  }
}
