import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
type CookieRequest = Request & { cookies?: Record<string, string | undefined> };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: { email: string; password: string; displayName?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token } = await this.auth.register(
      dto.email,
      dto.password,
      dto.displayName,
    );
    res.cookie('access_token', token, { httpOnly: true, sameSite: 'lax' });
    return user;
  }

  @Post('login')
  async login(
    @Body() dto: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token } = await this.auth.login(dto.email, dto.password);
    res.cookie('access_token', token, { httpOnly: true, sameSite: 'lax' });
    return user;
  }

  @Get('me')
  async me(@Req() req: CookieRequest) {
    const cookieHeader = req.headers['cookie'];
    const token = cookieHeader
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('access_token='))
      ?.split('=')[1];
    return this.auth.meFromToken(token);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { ok: true };
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res({ passthrough: true }) res: Response) {
    const { user } = req;
    const token = await this.auth.generateToken(user);
    res.cookie('access_token', token, { httpOnly: true, sameSite: 'lax' });
    res.redirect('http://localhost:5173/');
  }
}
