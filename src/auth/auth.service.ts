import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { randomBytes, pbkdf2Sync } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import type { User } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string, displayName?: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new ConflictException('Email ya registrado');
    const salt = randomBytes(16).toString('hex');
    const iterations = 310000;
    const derived = pbkdf2Sync(
      password,
      salt,
      iterations,
      32,
      'sha256',
    ).toString('hex');
    const passwordHash = `${salt}:${iterations}:${derived}`;
    const user = await this.users.create(email, passwordHash, displayName);
    const token = await this.jwt.signAsync({ sub: String((user as any)._id) });
    return { user: this.sanitize(user), token };
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('Credenciales inválidas');
    const [salt, iterStr, hash] = String(user.passwordHash).split(':');
    const iterations = Number(iterStr || 310000);
    const derived = pbkdf2Sync(
      password,
      salt,
      iterations,
      32,
      'sha256',
    ).toString('hex');
    const ok: boolean = derived === hash;
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    const token = await this.jwt.signAsync({ sub: String((user as any)._id) });
    return { user: this.sanitize(user), token };
  }

  async meFromToken(token?: string) {
    if (!token) throw new UnauthorizedException();
    const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return this.sanitize(user);
  }

  sanitize(u: User) {
    return {
      id: String((u as any)._id),
      email: String(u.email),
      displayName: u.displayName ? String(u.displayName) : undefined,
      avatarUrl: u.avatarUrl ? String(u.avatarUrl) : undefined,
    };
  }
}
