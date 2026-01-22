import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameEngineService } from './game-engine.service';
import type { PlayerAction } from './game.types';

interface JoinTablePayload {
  tableId: string;
  odId: string;
  odName: string;
  buyIn: number;
  seatIndex: number;
}

interface LeaveTablePayload {
  tableId: string;
  odId: string;
}

interface CreateTablePayload {
  tableId: string;
  gameType: 'texas' | 'omaha' | 'omaha_hi_lo' | 'short_deck';
  bettingType: 'NL' | 'PL';
  blinds: { small: number; big: number };
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private playerSockets: Map<string, { odId: string; tableId: string }> = new Map();

  constructor(private readonly gameEngine: GameEngineService) {}

  handleConnection(client: Socket) {
    console.log(`[GameGateway] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[GameGateway] Client disconnected: ${client.id}`);
    const playerInfo = this.playerSockets.get(client.id);
    if (playerInfo) {
      this.gameEngine.removePlayer(playerInfo.tableId, playerInfo.odId);
      this.playerSockets.delete(client.id);
      this.broadcastGameState(playerInfo.tableId);
    }
  }

  @SubscribeMessage('createTable')
  handleCreateTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateTablePayload,
  ) {
    this.gameEngine.createGame(
      payload.tableId,
      payload.gameType,
      payload.bettingType,
      payload.blinds,
    );
    client.join(payload.tableId);
    this.broadcastTableList();
    return { success: true, tableId: payload.tableId };
  }

  @SubscribeMessage('joinTable')
  handleJoinTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinTablePayload,
  ) {
    console.log(`[GameGateway] joinTable request from socket ${client.id}:`, payload);

    // Auto-create table if it doesn't exist
    if (!this.gameEngine.getGame(payload.tableId)) {
      console.log(`[GameGateway] Table ${payload.tableId} doesn't exist, creating it`);
      this.gameEngine.createGame(
        payload.tableId,
        'texas', // default game type
        'NL',    // default betting type
        { small: 1, big: 2 }, // default blinds
      );
    }

    const success = this.gameEngine.addPlayer(
      payload.tableId,
      payload.odId,
      payload.odName,
      payload.buyIn,
      payload.seatIndex,
    );

    if (success) {
      client.join(payload.tableId);
      this.playerSockets.set(client.id, { odId: payload.odId, tableId: payload.tableId });
      console.log(`[GameGateway] Player joined successfully, socket ${client.id} mapped to odId ${payload.odId}`);
      this.broadcastGameState(payload.tableId);
      this.broadcastTableList();
      return { success: true };
    }

    console.log(`[GameGateway] Player failed to join table`);
    return { success: false, error: 'Could not join table' };
  }

  @SubscribeMessage('leaveTable')
  handleLeaveTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LeaveTablePayload,
  ) {
    const success = this.gameEngine.removePlayer(payload.tableId, payload.odId);
    if (success) {
      client.leave(payload.tableId);
      this.playerSockets.delete(client.id);
      this.broadcastGameState(payload.tableId);
      this.broadcastTableList();
    }
    return { success };
  }

  @SubscribeMessage('startHand')
  handleStartHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tableId: string },
  ) {
    const state = this.gameEngine.startHand(payload.tableId);
    if (state) {
      this.broadcastGameState(payload.tableId);
      return { success: true };
    }
    return { success: false, error: 'Could not start hand' };
  }

  @SubscribeMessage('action')
  handleAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: PlayerAction,
  ) {
    // Validate that this socket owns this player
    const playerInfo = this.playerSockets.get(client.id);
    if (!playerInfo || playerInfo.odId !== payload.odId) {
      return { success: false, error: 'Unauthorized action' };
    }

    const result = this.gameEngine.processAction(payload.tableId, payload);

    if (result.success) {
      this.broadcastGameState(payload.tableId);
    }

    return result;
  }

  @SubscribeMessage('getState')
  handleGetState(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tableId: string; odId: string },
  ) {
    const state = this.gameEngine.getClientState(payload.tableId, payload.odId);
    return { success: !!state, state };
  }

  @SubscribeMessage('changeSeat')
  handleChangeSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tableId: string; odId: string; newSeatIndex: number },
  ) {
    console.log(`[GameGateway] changeSeat request from socket ${client.id}:`, payload);
    console.log(`[GameGateway] playerSockets entries:`, Array.from(this.playerSockets.entries()));

    // Validate that this socket owns this player
    const playerInfo = this.playerSockets.get(client.id);
    console.log(`[GameGateway] Found playerInfo for socket:`, playerInfo);

    if (!playerInfo || playerInfo.odId !== payload.odId) {
      console.log(`[GameGateway] Unauthorized: playerInfo=${JSON.stringify(playerInfo)}, payload.odId=${payload.odId}`);
      return { success: false, error: 'Unauthorized' };
    }

    const success = this.gameEngine.changeSeat(
      payload.tableId,
      payload.odId,
      payload.newSeatIndex,
    );

    if (success) {
      this.broadcastGameState(payload.tableId);
      this.broadcastTableList();
      return { success: true };
    }

    return { success: false, error: 'Could not change seat' };
  }

  @SubscribeMessage('watchTable')
  handleWatchTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tableId: string; odId: string },
  ) {
    console.log(`[GameGateway] watchTable request from socket ${client.id}:`, payload);

    // Auto-create table if it doesn't exist
    if (!this.gameEngine.getGame(payload.tableId)) {
      console.log(`[GameGateway] Table ${payload.tableId} doesn't exist, creating it for spectator`);
      this.gameEngine.createGame(
        payload.tableId,
        'texas', // default game type
        'NL',    // default betting type
        { small: 1, big: 2 }, // default blinds
      );
    }

    // Join the table room to receive spectator updates
    client.join(payload.tableId);
    console.log(`[GameGateway] Client ${client.id} now watching table ${payload.tableId}`);

    // Return spectator state
    const state = this.gameEngine.getClientState(payload.tableId, '__spectator__');
    return { success: true, state };
  }

  @SubscribeMessage('unwatchTable')
  handleUnwatchTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tableId: string },
  ) {
    client.leave(payload.tableId);
    console.log(`[GameGateway] Client ${client.id} stopped watching table ${payload.tableId}`);
    return { success: true };
  }

  @SubscribeMessage('getTables')
  handleGetTables(@ConnectedSocket() client: Socket) {
    const tables = this.gameEngine.getAllTables();
    return { success: true, tables };
  }

  @SubscribeMessage('subscribeTables')
  handleSubscribeTables(@ConnectedSocket() client: Socket) {
    client.join('lobby');
    const tables = this.gameEngine.getAllTables();
    return { success: true, tables };
  }

  @SubscribeMessage('unsubscribeTables')
  handleUnsubscribeTables(@ConnectedSocket() client: Socket) {
    client.leave('lobby');
    return { success: true };
  }

  @SubscribeMessage('createUserTable')
  handleCreateUserTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      gameType: 'texas' | 'omaha' | 'omaha_hi_lo' | 'short_deck' | 'courchevel' | 'royal' | 'manila' | 'pineapple' | 'fast_fold';
      stakeLabel: string;
      blinds: { small: number; big: number };
      bettingType: 'NL' | 'PL';
    },
  ) {
    console.log(`[GameGateway] createUserTable request:`, payload);
    const tableId = this.gameEngine.createUserTable(
      payload.gameType,
      payload.stakeLabel,
      payload.blinds,
      payload.bettingType,
    );
    this.broadcastTableList();
    return { success: true, tableId };
  }

  private broadcastTableList() {
    const tables = this.gameEngine.getAllTables();
    this.server.to('lobby').emit('tableList', tables);
  }

  private broadcastGameState(tableId: string) {
    const game = this.gameEngine.getGame(tableId);
    if (!game) return;

    // Send personalized state to each player (they only see their own cards)
    for (const player of game.state.players) {
      const clientState = this.gameEngine.getClientState(tableId, player.odId);
      
      // Find socket for this player
      for (const [socketId, info] of this.playerSockets.entries()) {
        if (info.odId === player.odId && info.tableId === tableId) {
          this.server.to(socketId).emit('gameState', clientState);
          break;
        }
      }
    }

    // Also broadcast a spectator view (no hole cards)
    const spectatorState = this.gameEngine.getClientState(tableId, '__spectator__');
    this.server.to(tableId).emit('spectatorState', spectatorState);
  }
}
