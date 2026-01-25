import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameEngineService } from './game-engine.service';
import { DeckService } from './deck.service';
import { HandEvaluatorService } from './hand-evaluator.service';
import { AntiCheatService } from './anti-cheat.service';
import { HandHistoryService } from './hand-history.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [
    GameGateway,
    GameEngineService,
    DeckService,
    HandEvaluatorService,
    AntiCheatService,
    HandHistoryService,
  ],
  exports: [GameEngineService, AntiCheatService, HandHistoryService],
})
export class GameModule {}
