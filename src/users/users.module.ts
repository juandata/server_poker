import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { DashboardController } from './dashboard.controller';
import { User, UserSchema } from './schemas/user.schema';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
