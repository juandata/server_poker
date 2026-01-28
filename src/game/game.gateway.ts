import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameEngineService } from './game-engine.service';
import type { PlayerAction } from './game.types';
import { AuthService } from '../auth/auth.service';

// Custom socket type - matches what AuthService.meFromToken returns
interface AuthenticatedUser {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
  };
}

interface JoinTablePayload {
  tableId: string;
  buyIn: number;
  seatIndex: number;
}

interface LeaveTablePayload {
  tableId: string;
}

interface CreateTablePayload {
  tableId: string;
  gameType: 'texas' | 'omaha' | 'omaha_hi_lo' | 'short_deck';
  bettingType: 'NL' | 'PL';
  blinds: { small: number; big: number };
}

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:5173',
    credentials: true,
  },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private playerSockets: Map<string, { odId: string; tableId: string }> = new Map();
  private disconnectTimeouts: Map<string, NodeJS.Timeout> = new Map(); // Grace period for reconnection
  private nextHandTimeouts: Map<string, NodeJS.Timeout> = new Map(); // Auto-start next hand timers

  constructor(
    private readonly gameEngine: GameEngineService,
    private readonly authService: AuthService,
  ) { }

  // Set up authentication middleware BEFORE any messages are processed
  afterInit(server: Server) {
    server.use(async (socket: AuthenticatedSocket, next) => {
      const cookieHeader = socket.handshake.headers['cookie'];

      if (cookieHeader) {
        const token = cookieHeader
          .split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('access_token='))
          ?.split('=')[1];

        if (token) {
          try {
            const user = await this.authService.meFromToken(token);
            if (user) {
              socket.data = { user };
              console.log(`[GameGateway] Socket authenticated: ${socket.id} - user: ${user.displayName || user.email}`);
            }
          } catch (err) {
            console.error(`[GameGateway] Auth middleware error:`, err);
          }
        }
      }

      // Always allow connection (authentication is optional for spectating)
      next();
    });
    console.log('[GameGateway] WebSocket server initialized with auth middleware');
  }

  handleConnection(client: AuthenticatedSocket) {
    const userName = client.data?.user?.displayName || client.data?.user?.email || 'Anonymous';
    const odId = client.data?.user?.id;
    console.log(`[GameGateway] Client connected: ${client.id} - user: ${userName} (odId: ${odId})`);

    // Cancel any pending disconnect timeout for this user (reconnection scenario)
    if (odId) {
      const existingTimeout = this.disconnectTimeouts.get(odId);
      if (existingTimeout) {
        console.log(`[GameGateway] Cancelling pending disconnect for user ${odId} - reconnected`);
        clearTimeout(existingTimeout);
        this.disconnectTimeouts.delete(odId);
      }
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    console.log(`[GameGateway] Client disconnected: ${client.id}`);
    const playerInfo = this.playerSockets.get(client.id);
    if (playerInfo) {
      // Use a grace period before removing the player (allows for reconnection)
      const DISCONNECT_GRACE_PERIOD_MS = 30000; // 30 seconds - match client reconnect window

      console.log(`[GameGateway] Starting ${DISCONNECT_GRACE_PERIOD_MS}ms grace period for player ${playerInfo.odId}`);

      // Mark player as disconnected immediately so other players see the status
      const game = this.gameEngine.getGame(playerInfo.tableId);
      if (game) {
        const player = game.state.players.find(p => p.odId === playerInfo.odId);
        if (player) {
          player.isConnected = false;
        }
        this.broadcastGameState(playerInfo.tableId);
      }

      // Clear any existing timeout for this user
      const existingTimeout = this.disconnectTimeouts.get(playerInfo.odId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        console.log(`[GameGateway] Grace period expired for player ${playerInfo.odId}, removing from table`);
        this.gameEngine.removePlayer(playerInfo.tableId, playerInfo.odId);
        this.disconnectTimeouts.delete(playerInfo.odId);
        this.broadcastGameState(playerInfo.tableId);
      }, DISCONNECT_GRACE_PERIOD_MS);

      this.disconnectTimeouts.set(playerInfo.odId, timeout);
      this.playerSockets.delete(client.id);
    }
  }

  @SubscribeMessage('createTable')
  handleCreateTable(
    @ConnectedSocket() client: AuthenticatedSocket,
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
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: JoinTablePayload,
  ) {
    console.log(`[GameGateway] joinTable request from socket ${client.id}:`, payload);
    const user = client.data?.user;

    if (!user || !user.id) {
      console.log(`[GameGateway] joinTable rejected - user not authenticated`);
      return { success: false, error: 'Not authenticated' };
    }

    // Cancel any pending disconnect timeout for this user
    const existingTimeout = this.disconnectTimeouts.get(user.id);
    if (existingTimeout) {
      console.log(`[GameGateway] Cancelling pending disconnect for user ${user.id} - rejoining table`);
      clearTimeout(existingTimeout);
      this.disconnectTimeouts.delete(user.id);
    }

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
      user.id,
      user.displayName || 'Guest',
      payload.buyIn,
      payload.seatIndex,
    );

    if (success) {
      client.join(payload.tableId);
      this.playerSockets.set(client.id, { odId: user.id, tableId: payload.tableId });
      console.log(`[GameGateway] Player joined successfully, socket ${client.id} mapped to odId ${user.id}`);
      this.broadcastGameState(payload.tableId);
      this.broadcastTableList();
      return { success: true };
    }

    console.log(`[GameGateway] Player failed to join table`);
    return { success: false, error: 'Could not join table' };
  }

  @SubscribeMessage('leaveTable')
  handleLeaveTable(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: LeaveTablePayload,
  ) {
    const user = client.data?.user;
    if (!user || !user.id) {
      return { success: false, error: 'Not authenticated' };
    }
    const success = this.gameEngine.removePlayer(payload.tableId, user.id);
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
    @ConnectedSocket() client: AuthenticatedSocket,
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
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: PlayerAction,
  ) {
    const user = client.data?.user;
    if (!user || !user.id) {
      return { success: false, error: 'Not authenticated' };
    }
    if (user.id !== payload.odId) {
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
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { tableId: string },
  ) {
    const user = client.data?.user;
    if (!user || !user.id) {
      return { success: false, error: 'Not authenticated' };
    }
    const state = this.gameEngine.getClientState(payload.tableId, user.id);
    return { success: !!state, state };
  }

  @SubscribeMessage('changeSeat')
  handleChangeSeat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { tableId: string; newSeatIndex: number },
  ) {
    console.log(`[GameGateway] changeSeat request from socket ${client.id}:`, payload);
    const user = client.data?.user;
    if (!user || !user.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const success = this.gameEngine.changeSeat(
      payload.tableId,
      user.id,
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
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { tableId: string },
  ) {
    console.log(`[GameGateway] watchTable request from socket ${client.id}:`, payload);
    const user = client.data?.user;

    // Cancel any pending disconnect timeout for this user (reconnection scenario)
    if (user?.id) {
      const existingTimeout = this.disconnectTimeouts.get(user.id);
      if (existingTimeout) {
        console.log(`[GameGateway] Cancelling pending disconnect for user ${user.id} - watching table again`);
        clearTimeout(existingTimeout);
        this.disconnectTimeouts.delete(user.id);
      }
    }

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

    // If user is authenticated, check if they're a player at this table and reconnect them
    let wasReconnected = false;
    if (user?.id) {
      const game = this.gameEngine.getGame(payload.tableId);
      const existingPlayer = game?.state.players.find(p => p.odId === user.id);

      if (existingPlayer && !existingPlayer.isConnected) {
        console.log(`[GameGateway] Reconnecting player ${user.id} to seat ${existingPlayer.seatIndex}`);
        existingPlayer.isConnected = true;
        existingPlayer.lastActionTime = Date.now();
        this.playerSockets.set(client.id, { odId: user.id, tableId: payload.tableId });
        wasReconnected = true;
        this.broadcastGameState(payload.tableId);
      }
    }

    // Return personalized state if user is seated, otherwise spectator state
    const state = user?.id
      ? this.gameEngine.getClientState(payload.tableId, user.id)
      : this.gameEngine.getClientState(payload.tableId, '__spectator__');
    return { success: true, state, wasReconnected };
  }

  @SubscribeMessage('unwatchTable')
  handleUnwatchTable(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { tableId: string },
  ) {
    client.leave(payload.tableId);
    console.log(`[GameGateway] Client ${client.id} stopped watching table ${payload.tableId}`);
    return { success: true };
  }

  @SubscribeMessage('getTables')
  handleGetTables(@ConnectedSocket() client: AuthenticatedSocket) {
    const tables = this.gameEngine.getAllTables();
    return { success: true, tables };
  }

  @SubscribeMessage('subscribeTables')
  handleSubscribeTables(@ConnectedSocket() client: AuthenticatedSocket) {
    client.join('lobby');
    const tables = this.gameEngine.getAllTables();
    return { success: true, tables };
  }

  @SubscribeMessage('unsubscribeTables')
  handleUnsubscribeTables(@ConnectedSocket() client: AuthenticatedSocket) {
    client.leave('lobby');
    return { success: true };
  }

  @SubscribeMessage('createUserTable')
  handleCreateUserTable(
    @ConnectedSocket() client: AuthenticatedSocket,
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

    console.log(`[GameGateway] broadcast: ${tableId} | stage=${game.state.stage} | players=${game.state.players.length} | pot=${game.state.pot} | active=${game.state.activePlayerIndex}`);

    // Send personalized state to each player (they only see their own cards)
    for (const player of game.state.players) {
      const clientState = this.gameEngine.getClientState(tableId, player.odId);
      if (!clientState) continue;

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

    // Schedule next hand if we just entered showdown
    this.scheduleNextHand(tableId);
  }

  /**
   * If the table is in showdown with 2+ players, schedule the next hand.
   * This is the ONLY place that auto-starts the next hand, ensuring broadcast happens.
   */
  private scheduleNextHand(tableId: string) {
    const game = this.gameEngine.getGame(tableId);
    if (!game) return;

    // Only schedule if in showdown with enough players
    if (game.state.stage !== 'showdown' || game.state.players.length < 2) return;

    // Don't schedule if already pending
    if (this.nextHandTimeouts.has(tableId)) return;

    console.log(`[GameGateway] Scheduling next hand for ${tableId} in 5 seconds`);
    const timeout = setTimeout(() => {
      this.nextHandTimeouts.delete(tableId);
      const currentGame = this.gameEngine.getGame(tableId);
      if (currentGame && currentGame.state.stage === 'showdown') {
        console.log(`[GameGateway] Auto-starting next hand for ${tableId}`);
        const state = this.gameEngine.startHand(tableId);
        if (state) {
          this.broadcastGameState(tableId);
        }
      }
    }, 5000);

    this.nextHandTimeouts.set(tableId, timeout);
  }
}
