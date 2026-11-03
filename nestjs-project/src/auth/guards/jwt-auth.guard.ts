import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BEARER_PREFIX } from '../auth.constants';
import { JwtPayload } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user: unknown }>();
    const authHeader = request.headers?.authorization;

    if (isPublic) {
      if (authHeader?.startsWith(BEARER_PREFIX)) {
        try {
          request.user = await this.jwtService.verifyAsync<JwtPayload>(
            authHeader.slice(BEARER_PREFIX.length),
          );
        } catch {
          // Public resources remain available anonymously when an optional token is invalid.
        }
      }
      return true;
    }

    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'UNAUTHENTICATED',
        message: 'Authentication is required',
      });
    }

    const token = authHeader.slice(BEARER_PREFIX.length);

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'UNAUTHENTICATED',
        message: 'Authentication is required',
      });
    }
  }
}
