import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { TablesGateway } from './tables/tables.gateway';
import { TablesModule } from './tables/tables.module';

@Module({
  imports: [
    MongooseModule.forRoot(
      process.env.MONGO_URL || 'mongodb://localhost:27017/poker',
    ),
    UsersModule,
    AuthModule,
    TablesModule,
  ],
  controllers: [AppController],
  providers: [AppService, TablesGateway],
})
export class AppModule {}
