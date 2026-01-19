import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { Transaction } from '../users/schemas/transaction.schema';

/**
 * Payment Methods Integration Guide for Colombia
 * 
 * This service provides integration with multiple payment providers:
 * 
 * 1. WOMPI (by Bancolombia) - https://wompi.co
 *    - Supports: PSE, Credit/Debit Cards, Nequi, Bancolombia transfers
 *    - Sandbox: https://sandbox.wompi.co
 *    - Docs: https://docs.wompi.co
 *    - Required: PUBLIC_KEY, PRIVATE_KEY, INTEGRITY_SECRET
 * 
 * 2. EPAYCO - https://epayco.co
 *    - Supports: PSE, Cards, Daviplata, Efecty, Baloto
 *    - Sandbox available
 *    - Docs: https://docs.epayco.co
 *    - Required: PUBLIC_KEY, PRIVATE_KEY, P_CUST_ID, P_KEY
 * 
 * 3. PAYU LATAM - https://www.payulatam.com
 *    - Supports: PSE, Cards, Cash payments
 *    - Sandbox available
 *    - Docs: https://developers.payulatam.com
 *    - Required: API_KEY, API_LOGIN, MERCHANT_ID, ACCOUNT_ID
 * 
 * 4. MERCADO PAGO - https://www.mercadopago.com.co
 *    - Supports: Cards, PSE, Efecty, Baloto
 *    - Sandbox available
 *    - Docs: https://www.mercadopago.com.co/developers
 *    - Required: ACCESS_TOKEN, PUBLIC_KEY
 * 
 * 5. CRYPTO (Coinbase Commerce / NOWPayments)
 *    - Supports: BTC, ETH, USDT, etc.
 *    - Docs: https://commerce.coinbase.com/docs
 *    - Required: API_KEY, WEBHOOK_SECRET
 */

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  provider: string;
  providerTransactionId?: string;
  redirectUrl?: string;
  qrCode?: string;
  expiresAt?: Date;
}

export interface WompiConfig {
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  sandbox: boolean;
}

export interface EpaycoConfig {
  publicKey: string;
  privateKey: string;
  custId: string;
  pKey: string;
  sandbox: boolean;
}

@Injectable()
export class PaymentsService {
  private wompiConfig: WompiConfig;
  private epaycoConfig: EpaycoConfig;

  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<Transaction>,
  ) {
    // Load payment provider configurations from environment
    this.wompiConfig = {
      publicKey: this.configService.get<string>('WOMPI_PUBLIC_KEY') || '',
      privateKey: this.configService.get<string>('WOMPI_PRIVATE_KEY') || '',
      integritySecret: this.configService.get<string>('WOMPI_INTEGRITY_SECRET') || '',
      sandbox: this.configService.get<string>('WOMPI_SANDBOX') === 'true',
    };

    this.epaycoConfig = {
      publicKey: this.configService.get<string>('EPAYCO_PUBLIC_KEY') || '',
      privateKey: this.configService.get<string>('EPAYCO_PRIVATE_KEY') || '',
      custId: this.configService.get<string>('EPAYCO_CUST_ID') || '',
      pKey: this.configService.get<string>('EPAYCO_P_KEY') || '',
      sandbox: this.configService.get<string>('EPAYCO_SANDBOX') === 'true',
    };
  }

  /**
   * Create a deposit intent with the specified payment method
   */
  async createDepositIntent(
    userId: string,
    amount: number,
    method: 'nequi' | 'bancolombia' | 'pse' | 'daviplata' | 'card' | 'crypto',
  ): Promise<PaymentIntent> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (amount < 10000) { // Minimum 10,000 COP
      throw new BadRequestException('Minimum deposit is $10,000 COP');
    }

    // Create transaction record
    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'deposit',
      amount,
      status: 'pending',
      method: method.toUpperCase(),
      description: `Depósito vía ${method.toUpperCase()}`,
      reference: `DEP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });
    await transaction.save();

    // Route to appropriate payment provider
    switch (method) {
      case 'nequi':
      case 'bancolombia':
      case 'pse':
        return this.createWompiPayment(transaction._id.toString(), amount, method, user.email);
      
      case 'daviplata':
        return this.createEpaycoPayment(transaction._id.toString(), amount, method, user.email);
      
      case 'card':
        return this.createCardPayment(transaction._id.toString(), amount, user.email);
      
      case 'crypto':
        return this.createCryptoPayment(transaction._id.toString(), amount, user.email);
      
      default:
        throw new BadRequestException('Unsupported payment method');
    }
  }

  /**
   * WOMPI Integration (Nequi, Bancolombia, PSE)
   * Documentation: https://docs.wompi.co
   */
  private async createWompiPayment(
    transactionId: string,
    amount: number,
    method: string,
    email: string,
  ): Promise<PaymentIntent> {
    const baseUrl = this.wompiConfig.sandbox
      ? 'https://sandbox.wompi.co/v1'
      : 'https://production.wompi.co/v1';

    // In production, you would make an API call to Wompi here
    // Example for creating a payment link:
    /*
    const response = await fetch(`${baseUrl}/payment_links`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.wompiConfig.privateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Depósito Riverflow Poker',
        description: `Depósito de $${amount} COP`,
        single_use: true,
        collect_shipping: false,
        currency: 'COP',
        amount_in_cents: amount * 100,
        redirect_url: `${process.env.FRONTEND_URL}/dashboard?deposit=success`,
        customer_data: {
          customer_references: [{ label: 'Transaction ID', value: transactionId }],
        },
      }),
    });
    const data = await response.json();
    */

    // Mock response for development
    return {
      id: transactionId,
      amount,
      currency: 'COP',
      status: 'pending',
      provider: 'wompi',
      redirectUrl: `https://checkout.wompi.co/l/${transactionId}`, // Would be real URL from API
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    };
  }

  /**
   * EPAYCO Integration (Daviplata, Efecty)
   * Documentation: https://docs.epayco.co
   */
  private async createEpaycoPayment(
    transactionId: string,
    amount: number,
    method: string,
    email: string,
  ): Promise<PaymentIntent> {
    // In production, integrate with ePayco SDK/API
    /*
    const epayco = require('epayco-sdk-node')({
      apiKey: this.epaycoConfig.publicKey,
      privateKey: this.epaycoConfig.privateKey,
      lang: 'ES',
      test: this.epaycoConfig.sandbox,
    });

    const response = await epayco.daviplata.create({
      doc_type: 'CC',
      document: userDocument,
      name: userName,
      last_name: userLastName,
      email: email,
      ind_country: 'CO',
      phone: userPhone,
      country: 'CO',
      invoice: transactionId,
      description: 'Depósito Riverflow Poker',
      value: amount.toString(),
      tax: '0',
      tax_base: amount.toString(),
      currency: 'COP',
    });
    */

    return {
      id: transactionId,
      amount,
      currency: 'COP',
      status: 'pending',
      provider: 'epayco',
      redirectUrl: `https://secure.epayco.co/checkout/${transactionId}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  /**
   * Card Payment (via Wompi or Stripe)
   */
  private async createCardPayment(
    transactionId: string,
    amount: number,
    email: string,
  ): Promise<PaymentIntent> {
    // Can use Wompi, Stripe, or PayU for card payments
    return {
      id: transactionId,
      amount,
      currency: 'COP',
      status: 'pending',
      provider: 'wompi',
      redirectUrl: `https://checkout.wompi.co/l/${transactionId}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  /**
   * Crypto Payment (via Coinbase Commerce or NOWPayments)
   * Documentation: https://commerce.coinbase.com/docs
   */
  private async createCryptoPayment(
    transactionId: string,
    amount: number,
    email: string,
  ): Promise<PaymentIntent> {
    // Convert COP to USD for crypto payment
    const usdAmount = amount / 4000; // Approximate exchange rate

    // In production, create charge with Coinbase Commerce
    /*
    const response = await fetch('https://api.commerce.coinbase.com/charges', {
      method: 'POST',
      headers: {
        'X-CC-Api-Key': process.env.COINBASE_COMMERCE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Riverflow Poker Deposit',
        description: `Deposit of $${usdAmount.toFixed(2)} USD`,
        pricing_type: 'fixed_price',
        local_price: { amount: usdAmount.toFixed(2), currency: 'USD' },
        metadata: { transaction_id: transactionId },
        redirect_url: `${process.env.FRONTEND_URL}/dashboard?deposit=success`,
        cancel_url: `${process.env.FRONTEND_URL}/dashboard?deposit=cancelled`,
      }),
    });
    const data = await response.json();
    */

    return {
      id: transactionId,
      amount,
      currency: 'COP',
      status: 'pending',
      provider: 'crypto',
      redirectUrl: `https://commerce.coinbase.com/charges/${transactionId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour for crypto
    };
  }

  /**
   * Handle webhook from payment provider
   */
  async handleWebhook(
    provider: string,
    payload: any,
    signature: string,
  ): Promise<{ success: boolean }> {
    // Verify webhook signature based on provider
    switch (provider) {
      case 'wompi':
        return this.handleWompiWebhook(payload, signature);
      case 'epayco':
        return this.handleEpaycoWebhook(payload, signature);
      case 'crypto':
        return this.handleCryptoWebhook(payload, signature);
      default:
        throw new BadRequestException('Unknown provider');
    }
  }

  private async handleWompiWebhook(payload: any, signature: string): Promise<{ success: boolean }> {
    // Verify signature using WOMPI_INTEGRITY_SECRET
    // const expectedSignature = crypto.createHmac('sha256', this.wompiConfig.integritySecret)
    //   .update(JSON.stringify(payload))
    //   .digest('hex');
    
    // if (signature !== expectedSignature) {
    //   throw new BadRequestException('Invalid signature');
    // }

    const { event, data } = payload;
    
    if (event === 'transaction.updated') {
      const transactionId = data.transaction.reference;
      const status = data.transaction.status;

      if (status === 'APPROVED') {
        await this.completeDeposit(transactionId);
      } else if (status === 'DECLINED' || status === 'ERROR') {
        await this.failDeposit(transactionId);
      }
    }

    return { success: true };
  }

  private async handleEpaycoWebhook(payload: any, signature: string): Promise<{ success: boolean }> {
    const { x_ref_payco, x_response } = payload;
    
    if (x_response === 'Aceptada') {
      await this.completeDeposit(x_ref_payco);
    } else if (x_response === 'Rechazada' || x_response === 'Fallida') {
      await this.failDeposit(x_ref_payco);
    }

    return { success: true };
  }

  private async handleCryptoWebhook(payload: any, signature: string): Promise<{ success: boolean }> {
    const { event, data } = payload;
    
    if (event.type === 'charge:confirmed') {
      const transactionId = data.metadata.transaction_id;
      await this.completeDeposit(transactionId);
    } else if (event.type === 'charge:failed') {
      const transactionId = data.metadata.transaction_id;
      await this.failDeposit(transactionId);
    }

    return { success: true };
  }

  /**
   * Complete a deposit and credit user balance
   */
  private async completeDeposit(transactionId: string): Promise<void> {
    const transaction = await this.transactionModel.findById(transactionId).exec();
    if (!transaction || transaction.status !== 'pending') {
      return;
    }

    // Update transaction status
    await this.transactionModel.findByIdAndUpdate(transactionId, {
      status: 'completed',
      processedAt: new Date(),
    });

    // Credit user balance
    await this.userModel.findByIdAndUpdate(transaction.userId, {
      $inc: { 'wallet.real': transaction.amount },
    });
  }

  /**
   * Mark deposit as failed
   */
  private async failDeposit(transactionId: string): Promise<void> {
    await this.transactionModel.findByIdAndUpdate(transactionId, {
      status: 'failed',
      processedAt: new Date(),
    });
  }

  /**
   * Process withdrawal request
   */
  async processWithdrawal(
    userId: string,
    amount: number,
    method: 'nequi' | 'bancolombia' | 'daviplata' | 'crypto',
    accountDetails: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isVerified) {
      throw new BadRequestException('Account must be verified to withdraw');
    }

    const realBalance = user.wallet?.real || 0;
    if (amount > realBalance) {
      throw new BadRequestException('Insufficient balance');
    }

    if (amount < 50000) { // Minimum 50,000 COP
      throw new BadRequestException('Minimum withdrawal is $50,000 COP');
    }

    // Deduct from balance
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { 'wallet.real': -amount },
    });

    // Create withdrawal transaction
    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'withdrawal',
      amount,
      status: 'pending',
      method: method.toUpperCase(),
      description: `Retiro a ${method.toUpperCase()} - ${accountDetails}`,
      reference: `WTH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      balanceAfter: realBalance - amount,
    });
    await transaction.save();

    // In production, you would initiate the payout via the payment provider's API
    // For now, withdrawals are processed manually by admin

    return {
      success: true,
      message: 'Retiro en proceso. El tiempo estimado es de 24-48 horas hábiles.',
    };
  }
}
