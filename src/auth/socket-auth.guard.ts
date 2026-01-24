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

    if (!cookieHeader) {
      client.emit('authError', { message: 'Authentication failed: No cookie header' });
      return false;
    }

    const token = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('access_token='))
      ?.split('=')[1];

    if (!token) {
      client.emit('authError', { message: 'Authentication failed: No access token found' });
      return false;
    }

    return this.authService.meFromToken(token).then((user) => {
      if (!user) {
        client.emit('authError', { message: 'Authentication failed: Invalid token' });
        return false;
      }
      client.data.user = user;
      return true;
    }).catch((err) => {
      console.error('Authentication error:', err);
      client.emit('authError', { message: 'Authentication failed: Server error' });
      return false;
    });
  }
}
