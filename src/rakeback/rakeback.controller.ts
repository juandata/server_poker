import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { RakebackService } from './rakeback.service';

// Note: In production, add proper authentication guard
// import { AuthGuard } from '../auth/auth.guard';

@Controller('rakeback')
export class RakebackController {
  constructor(private readonly rakebackService: RakebackService) {}

  /**
   * Get rakeback statistics for the authenticated user
   */
  @Get('stats/:userId')
  async getStats(@Param('userId') userId: string) {
    return this.rakebackService.getRakebackStats(userId);
  }

  /**
   * Claim pending rakeback
   */
  @Post('claim/:userId')
  async claimRakeback(@Param('userId') userId: string) {
    const result = await this.rakebackService.claimRakeback(userId);
    return {
      success: true,
      amount: result.amount,
      transactionId: result.transaction._id,
      message: `Rakeback de $${result.amount.toFixed(2)} reclamado exitosamente`,
    };
  }

  /**
   * Get tier information
   */
  @Get('tiers')
  getTiers() {
    return {
      tiers: [
        { tier: 'bronze', minRake: 0, percentage: 20, benefits: 'Rakeback básico' },
        { tier: 'silver', minRake: 50, percentage: 25, benefits: 'Rakeback + Freerolls' },
        { tier: 'gold', minRake: 100, percentage: 30, benefits: 'Rakeback + Torneos VIP' },
        { tier: 'platinum', minRake: 500, percentage: 35, benefits: 'Rakeback + Soporte prioritario' },
        { tier: 'diamond', minRake: 1000, percentage: 40, benefits: 'Máximo rakeback + Todos los beneficios' },
      ],
    };
  }
}
