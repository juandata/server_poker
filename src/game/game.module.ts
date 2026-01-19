import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameEngineService } from './game-engine.service';
import { DeckService } from './deck.service';
import { HandEvaluatorService } from './hand-evaluator.service';
import { AntiCheatService } from './anti-cheat.service';

@Module({
  providers: [
    GameGateway,
    GameEngineService,
    DeckService,
    HandEvaluatorService,
    AntiCheatService,
  ],
  exports: [GameEngineService, AntiCheatService],
})
export class GameModule {}
