import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { ApiConfig } from '@hubmine/config';
import { AuditService } from '../audit/audit.service.js';
import { API_CONFIG } from '../config/config.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER, TokenService } from './token.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', expiresIn: config.JWT_ACCESS_TTL_SECONDS, issuer: ACCESS_TOKEN_ISSUER, audience: ACCESS_TOKEN_AUDIENCE },
        verifyOptions: { algorithms: ['HS256'], issuer: ACCESS_TOKEN_ISSUER, audience: ACCESS_TOKEN_AUDIENCE },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PasswordService, TokenService, AuditService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [TokenService, AuditService],
})
export class AuthModule {}
