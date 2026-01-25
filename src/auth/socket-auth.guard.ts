import { CanActivate, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class SocketAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(
    context: any,
  ): boolean | any | Promise<boolean | any> | Observable<boolean | any> {
    const client: Socket = context.switchToWs().getClient();
    const cookieHeader = client.handshake.headers['cookie'];

    console.log('[SocketAuthGuard] Headers:', JSON.stringify(client.handshake.headers, null, 2));
    console.log('[SocketAuthGuard] Cookie header:', cookieHeader);

    if (!cookieHeader) {
      console.log('[SocketAuthGuard] No cookie header found');
      client.emit('authError', { message: 'Authentication failed: No cookie header' });
      return false;
    }

    const token = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('access_token='))
      ?.split('=')[1];

    if (!token) {
      console.log('[SocketAuthGuard] No access_token found in cookies');
      client.emit('authError', { message: 'Authentication failed: No access token found' });
      return false;
    }

    console.log('[SocketAuthGuard] Found token, validating...');

    return this.authService.meFromToken(token).then((user) => {
      if (!user) {
        console.log('[SocketAuthGuard] Token validation failed - no user returned');
        client.emit('authError', { message: 'Authentication failed: Invalid token' });
        return false;
      }
      console.log('[SocketAuthGuard] Authentication successful for user:', user.displayName || user.email);
      client.data.user = user;
      return true;
    }).catch((err) => {
      console.error('[SocketAuthGuard] Authentication error:', err);
      client.emit('authError', { message: 'Authentication failed: Server error' });
      return false;
    });
  }
}
