import { Test, TestingModule } from '@nestjs/testing';
import { TablesGateway } from './tables.gateway';

describe('TablesGateway', () => {
  let gateway: TablesGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TablesGateway],
    }).compile();

    gateway = module.get<TablesGateway>(TablesGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
