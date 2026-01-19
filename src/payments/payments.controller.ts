import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Request } from 'express';

// DTOs
class CreateDepositDto {
  amount: number;
  method: 'nequi' | 'bancolombia' | 'pse' | 'daviplata' | 'card' | 'crypto';
}

class CreateWithdrawalDto {
  amount: number;
  method: 'nequi' | 'bancolombia' | 'daviplata' | 'crypto';
  accountDetails: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Get available payment methods
   */
  @Get('methods')
  getPaymentMethods() {
    return {
      deposit: [
        {
          id: 'nequi',
          name: 'Nequi',
          icon: '📱',
          minAmount: 10000,
          maxAmount: 5000000,
          processingTime: 'Instantáneo',
          fee: 0,
        },
        {
          id: 'bancolombia',
          name: 'Bancolombia',
          icon: '🏦',
          minAmount: 10000,
          maxAmount: 10000000,
          processingTime: 'Instantáneo',
          fee: 0,
        },
        {
          id: 'pse',
          name: 'PSE',
          icon: '🏛️',
          minAmount: 10000,
          maxAmount: 20000000,
          processingTime: '1-2 horas',
          fee: 0,
        },
        {
          id: 'daviplata',
          name: 'Daviplata',
          icon: '💳',
          minAmount: 10000,
          maxAmount: 3000000,
          processingTime: 'Instantáneo',
          fee: 0,
        },
        {
          id: 'card',
          name: 'Tarjeta Crédito/Débito',
          icon: '💳',
          minAmount: 20000,
          maxAmount: 10000000,
          processingTime: 'Instantáneo',
          fee: 2.9,
        },
        {
          id: 'crypto',
          name: 'Criptomonedas',
          icon: '₿',
          minAmount: 50000,
          maxAmount: 100000000,
          processingTime: '10-60 minutos',
          fee: 1,
        },
      ],
      withdrawal: [
        {
          id: 'nequi',
          name: 'Nequi',
          icon: '📱',
          minAmount: 50000,
          maxAmount: 5000000,
          processingTime: '24-48 horas',
          fee: 0,
        },
        {
          id: 'bancolombia',
          name: 'Bancolombia',
          icon: '🏦',
          minAmount: 50000,
          maxAmount: 10000000,
          processingTime: '24-48 horas',
          fee: 0,
        },
        {
          id: 'daviplata',
          name: 'Daviplata',
          icon: '💳',
          minAmount: 50000,
          maxAmount: 3000000,
          processingTime: '24-48 horas',
          fee: 0,
        },
        {
          id: 'crypto',
          name: 'Criptomonedas',
          icon: '₿',
          minAmount: 100000,
          maxAmount: 100000000,
          processingTime: '1-24 horas',
          fee: 0.5,
        },
      ],
    };
  }

  /**
   * Create deposit intent
   */
  @Post('deposit/:userId')
  async createDeposit(
    @Param('userId') userId: string,
    @Body() dto: CreateDepositDto,
  ) {
    return this.paymentsService.createDepositIntent(userId, dto.amount, dto.method);
  }

  /**
   * Create withdrawal request
   */
  @Post('withdraw/:userId')
  async createWithdrawal(
    @Param('userId') userId: string,
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.paymentsService.processWithdrawal(
      userId,
      dto.amount,
      dto.method,
      dto.accountDetails,
    );
  }

  /**
   * Webhook endpoint for Wompi
   */
  @Post('webhooks/wompi')
  async wompiWebhook(
    @Body() payload: any,
    @Headers('x-event-checksum') signature: string,
  ) {
    return this.paymentsService.handleWebhook('wompi', payload, signature);
  }

  /**
   * Webhook endpoint for ePayco
   */
  @Post('webhooks/epayco')
  async epaycoWebhook(@Body() payload: any) {
    return this.paymentsService.handleWebhook('epayco', payload, '');
  }

  /**
   * Webhook endpoint for Crypto (Coinbase Commerce)
   */
  @Post('webhooks/crypto')
  async cryptoWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-cc-webhook-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook('crypto', req.body, signature);
  }
}
