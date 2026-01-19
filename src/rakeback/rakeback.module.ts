import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RakebackService } from './rakeback.service';
import { RakebackController } from './rakeback.controller';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Transaction, TransactionSchema } from '../users/schemas/transaction.schema';
import { RakeContribution, RakeContributionSchema } from '../users/schemas/rake-contribution.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: RakeContribution.name, schema: RakeContributionSchema },
    ]),
  ],
  controllers: [RakebackController],
  providers: [RakebackService],
  exports: [RakebackService],
})
export class RakebackModule {}
