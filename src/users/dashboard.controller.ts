import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';

// DTOs
class AddPaymentMethodDto {
  type: 'nequi' | 'bancolombia' | 'daviplata' | 'pse' | 'crypto';
  name: string;
  details: string;
}

class DepositDto {
  amount: number;
  paymentMethodId: string;
}

class WithdrawDto {
  amount: number;
  paymentMethodId: string;
}

class UploadDocumentDto {
  type: 'id_front' | 'id_back' | 'selfie' | 'proof_address';
  fileUrl: string;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get user dashboard data (balance, stats, etc.)
   */
  @Get('user/:userId')
  async getUserDashboard(@Param('userId') userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      return { error: 'User not found' };
    }

    return {
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        phoneNumber: user.phoneNumber,
        isVerified: user.isVerified,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
      },
      wallet: user.wallet || { real: 0, bonus: 0, wageringRequired: 0, wageringProgress: 0 },
      rakeback: user.rakeback || {
        totalRakeGenerated: 0,
        currentMonthRake: 0,
        rakebackEarned: 0,
        rakebackPending: 0,
        rakebackPercentage: 20,
        tier: 'bronze',
        nextTierProgress: 0,
      },
      paymentMethods: user.paymentMethods || [],
      verificationDocs: user.verificationDocs || [],
    };
  }

  /**
   * Get user transactions
   */
  @Get('transactions/:userId')
  async getTransactions(
    @Param('userId') userId: string,
  ) {
    return this.usersService.getTransactions(userId);
  }

  /**
   * Add payment method
   */
  @Post('payment-methods/:userId')
  async addPaymentMethod(
    @Param('userId') userId: string,
    @Body() dto: AddPaymentMethodDto,
  ) {
    return this.usersService.addPaymentMethod(userId, dto);
  }

  /**
   * Remove payment method
   */
  @Delete('payment-methods/:userId/:methodId')
  async removePaymentMethod(
    @Param('userId') userId: string,
    @Param('methodId') methodId: string,
  ) {
    return this.usersService.removePaymentMethod(userId, methodId);
  }

  /**
   * Set default payment method
   */
  @Put('payment-methods/:userId/:methodId/default')
  async setDefaultPaymentMethod(
    @Param('userId') userId: string,
    @Param('methodId') methodId: string,
  ) {
    return this.usersService.setDefaultPaymentMethod(userId, methodId);
  }

  /**
   * Request deposit
   */
  @Post('deposit/:userId')
  async requestDeposit(
    @Param('userId') userId: string,
    @Body() dto: DepositDto,
  ) {
    return this.usersService.createDeposit(userId, dto.amount, dto.paymentMethodId);
  }

  /**
   * Request withdrawal
   */
  @Post('withdraw/:userId')
  async requestWithdrawal(
    @Param('userId') userId: string,
    @Body() dto: WithdrawDto,
  ) {
    return this.usersService.createWithdrawal(userId, dto.amount, dto.paymentMethodId);
  }

  /**
   * Upload verification document
   */
  @Post('verification/:userId')
  async uploadDocument(
    @Param('userId') userId: string,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.usersService.uploadVerificationDocument(userId, dto.type, dto.fileUrl);
  }

  /**
   * Get verification status
   */
  @Get('verification/:userId')
  async getVerificationStatus(@Param('userId') userId: string) {
    return this.usersService.getVerificationStatus(userId);
  }
}
