import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AdminService } from './admin.service';

// DTOs
class ReviewVerificationDto {
  docType: 'id_front' | 'id_back' | 'selfie' | 'proof_address';
  approved: boolean;
  rejectionReason?: string;
}

class UpdateTransactionDto {
  status: 'completed' | 'failed' | 'cancelled';
  adminNote?: string;
}

class UpdateUserStatusDto {
  status: 'active' | 'suspended' | 'banned';
}

class AdjustBalanceDto {
  amount: number;
  type: 'real' | 'bonus';
  reason: string;
}

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * Middleware to check admin access
   */
  private async checkAdmin(adminId: string) {
    const isAdmin = await this.adminService.isAdmin(adminId);
    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
  }

  /**
   * Get admin dashboard statistics
   */
  @Get('stats/:adminId')
  async getStats(@Param('adminId') adminId: string) {
    await this.checkAdmin(adminId);
    return this.adminService.getStats();
  }

  /**
   * Get all users with pagination and search
   */
  @Get('users/:adminId')
  async getUsers(
    @Param('adminId') adminId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('search') search?: string,
  ) {
    await this.checkAdmin(adminId);
    return this.adminService.getUsers(
      parseInt(page, 10),
      parseInt(limit, 10),
      search,
    );
  }

  /**
   * Get specific user details
   */
  @Get('users/:adminId/:userId')
  async getUserDetails(
    @Param('adminId') adminId: string,
    @Param('userId') userId: string,
  ) {
    await this.checkAdmin(adminId);
    return this.adminService.getUserDetails(userId);
  }

  /**
   * Get pending verifications
   */
  @Get('verifications/:adminId')
  async getPendingVerifications(@Param('adminId') adminId: string) {
    await this.checkAdmin(adminId);
    return this.adminService.getPendingVerifications();
  }

  /**
   * Review verification document
   */
  @Post('verifications/:adminId/:userId')
  async reviewVerification(
    @Param('adminId') adminId: string,
    @Param('userId') userId: string,
    @Body() dto: ReviewVerificationDto,
  ) {
    await this.checkAdmin(adminId);
    return this.adminService.reviewVerification(
      userId,
      dto.docType,
      dto.approved,
      dto.rejectionReason,
    );
  }

  /**
   * Get all transactions
   */
  @Get('transactions/:adminId')
  async getTransactions(
    @Param('adminId') adminId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    await this.checkAdmin(adminId);
    return this.adminService.getTransactions(
      parseInt(page, 10),
      parseInt(limit, 10),
      type,
      status,
    );
  }

  /**
   * Update transaction status
   */
  @Put('transactions/:adminId/:transactionId')
  async updateTransaction(
    @Param('adminId') adminId: string,
    @Param('transactionId') transactionId: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    await this.checkAdmin(adminId);
    return this.adminService.updateTransactionStatus(
      transactionId,
      dto.status,
      dto.adminNote,
    );
  }

  /**
   * Update user status
   */
  @Put('users/:adminId/:userId/status')
  async updateUserStatus(
    @Param('adminId') adminId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    await this.checkAdmin(adminId);
    return this.adminService.updateUserStatus(userId, dto.status);
  }

  /**
   * Adjust user balance
   */
  @Post('users/:adminId/:userId/balance')
  async adjustBalance(
    @Param('adminId') adminId: string,
    @Param('userId') userId: string,
    @Body() dto: AdjustBalanceDto,
  ) {
    await this.checkAdmin(adminId);
    return this.adminService.adjustBalance(
      userId,
      dto.amount,
      dto.type,
      dto.reason,
    );
  }
}
