import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { Transaction } from '../users/schemas/transaction.schema';
import { UsersService } from '../users/users.service';

export interface AdminStats {
  totalUsers: number;
  verifiedUsers: number;
  pendingVerifications: number;
  totalDeposits: number;
  totalWithdrawals: number;
  pendingWithdrawals: number;
  totalRakeGenerated: number;
  totalRakebackPaid: number;
  activeUsersToday: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  isVerified: boolean;
  status: string;
  balance: number;
  bonusBalance: number;
  rakebackTier: string;
  createdAt: Date;
  lastLoginAt?: Date;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Check if user is admin (for now, check by email domain or specific emails)
   */
  async isAdmin(userId: string): Promise<boolean> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) return false;
    
    // Admin check - you can customize this logic
    const adminEmails = ['admin@riverflow.club', 'support@riverflow.club'];
    return adminEmails.includes(user.email.toLowerCase());
  }

  /**
   * Get admin dashboard statistics
   */
  async getStats(): Promise<AdminStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      verifiedUsers,
      pendingVerifications,
      deposits,
      withdrawals,
      pendingWithdrawals,
      activeUsersToday,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ isVerified: true }),
      this.userModel.countDocuments({ 'verificationDocs.status': 'pending' }),
      this.transactionModel.aggregate([
        { $match: { type: 'deposit', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.transactionModel.aggregate([
        { $match: { type: 'withdrawal', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.transactionModel.countDocuments({ type: 'withdrawal', status: 'pending' }),
      this.userModel.countDocuments({ lastLoginAt: { $gte: today } }),
    ]);

    // Calculate total rake and rakeback from users
    const rakeStats = await this.userModel.aggregate([
      {
        $group: {
          _id: null,
          totalRake: { $sum: '$rakeback.totalRakeGenerated' },
          totalRakeback: { $sum: '$rakeback.rakebackEarned' },
        },
      },
    ]);

    return {
      totalUsers,
      verifiedUsers,
      pendingVerifications,
      totalDeposits: deposits[0]?.total || 0,
      totalWithdrawals: withdrawals[0]?.total || 0,
      pendingWithdrawals,
      totalRakeGenerated: rakeStats[0]?.totalRake || 0,
      totalRakebackPaid: rakeStats[0]?.totalRakeback || 0,
      activeUsersToday,
    };
  }

  /**
   * Get all users with pagination
   */
  async getUsers(page: number = 1, limit: number = 20, search?: string): Promise<{
    users: UserListItem[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const query: any = {};
    
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('email displayName isVerified status wallet rakeback createdAt lastLoginAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(query),
    ]);

    return {
      users: users.map(u => ({
        id: u._id.toString(),
        email: u.email,
        displayName: u.displayName || '',
        isVerified: u.isVerified,
        status: u.status,
        balance: u.wallet?.real || 0,
        bonusBalance: u.wallet?.bonus || 0,
        rakebackTier: u.rakeback?.tier || 'bronze',
        createdAt: (u as any).createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get user details for admin view
   */
  async getUserDetails(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const transactions = await this.transactionModel
      .find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        phoneNumber: user.phoneNumber,
        isVerified: user.isVerified,
        status: user.status,
        createdAt: (user as any).createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      wallet: user.wallet,
      rakeback: user.rakeback,
      paymentMethods: user.paymentMethods,
      verificationDocs: user.verificationDocs,
      transactions,
    };
  }

  /**
   * Get all pending verification documents
   */
  async getPendingVerifications(): Promise<Array<{
    userId: string;
    email: string;
    displayName: string;
    document: any;
  }>> {
    const users = await this.userModel
      .find({ 'verificationDocs.status': 'pending' })
      .select('email displayName verificationDocs')
      .exec();

    const pending: Array<{
      userId: string;
      email: string;
      displayName: string;
      document: any;
    }> = [];

    users.forEach(user => {
      user.verificationDocs
        .filter(doc => doc.status === 'pending')
        .forEach(doc => {
          pending.push({
            userId: user._id.toString(),
            email: user.email,
            displayName: user.displayName || '',
            document: doc,
          });
        });
    });

    return pending;
  }

  /**
   * Review verification document (approve/reject)
   */
  async reviewVerification(
    userId: string,
    docType: 'id_front' | 'id_back' | 'selfie' | 'proof_address',
    approved: boolean,
    rejectionReason?: string,
  ) {
    return this.usersService.reviewVerificationDocument(userId, docType, approved, rejectionReason);
  }

  /**
   * Get all transactions with filters
   */
  async getTransactions(
    page: number = 1,
    limit: number = 50,
    type?: string,
    status?: string,
  ) {
    const query: any = {};
    if (type) query.type = type;
    if (status) query.status = status;

    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'email displayName')
        .exec(),
      this.transactionModel.countDocuments(query),
    ]);

    return {
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Update transaction status (for manual processing)
   */
  async updateTransactionStatus(
    transactionId: string,
    status: 'completed' | 'failed' | 'cancelled',
    adminNote?: string,
  ) {
    const transaction = await this.transactionModel.findById(transactionId).exec();
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // If completing a deposit, add to user balance
    if (status === 'completed' && transaction.type === 'deposit' && transaction.status === 'pending') {
      await this.userModel.findByIdAndUpdate(transaction.userId, {
        $inc: { 'wallet.real': transaction.amount },
      });
    }

    // If cancelling a withdrawal, return funds to user
    if ((status === 'cancelled' || status === 'failed') && transaction.type === 'withdrawal' && transaction.status === 'pending') {
      await this.userModel.findByIdAndUpdate(transaction.userId, {
        $inc: { 'wallet.real': transaction.amount },
      });
    }

    await this.transactionModel.findByIdAndUpdate(transactionId, {
      status,
      adminNote,
      processedAt: new Date(),
    });

    return { success: true };
  }

  /**
   * Update user status (suspend/ban/activate)
   */
  async updateUserStatus(userId: string, status: 'active' | 'suspended' | 'banned') {
    await this.userModel.findByIdAndUpdate(userId, { status });
    return { success: true };
  }

  /**
   * Manually adjust user balance (for support/corrections)
   */
  async adjustBalance(
    userId: string,
    amount: number,
    type: 'real' | 'bonus',
    reason: string,
  ) {
    const field = type === 'real' ? 'wallet.real' : 'wallet.bonus';
    
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { [field]: amount },
    });

    // Create a transaction record for audit
    const transaction = new this.transactionModel({
      userId,
      type: amount > 0 ? 'bonus' : 'withdrawal',
      amount: Math.abs(amount),
      status: 'completed',
      method: 'Admin Adjustment',
      description: reason,
      reference: `ADJ-${Date.now()}`,
    });
    await transaction.save();

    return { success: true };
  }
}
