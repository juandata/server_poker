import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';

@WebSocketGateway()
export class TablesGateway {
  @SubscribeMessage('message')
  handleMessage(): string {
    return 'Hello world!';
  }
}
