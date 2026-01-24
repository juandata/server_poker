import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameEngineService } from './game-engine.service';
import { DeckService } from './deck.service';
import { HandEvaluatorService } from './hand-evaluator.service';
import { AntiCheatService } from './anti-cheat.service';
import { HandHistoryService } from './hand-history.service';
import { AuthModule } from '../auth/auth.module';
import { SocketAuthGuard } from '../auth/socket-auth.guard';

@Module({
  imports: [AuthModule],
  providers: [
    GameGateway,
    GameEngineService,
    DeckService,
    HandEvaluatorService,
    AntiCheatService,
    HandHistoryService,
    SocketAuthGuard,
  ],
  exports: [GameEngineService, AntiCheatService, HandHistoryService],
})
export class GameModule {}
