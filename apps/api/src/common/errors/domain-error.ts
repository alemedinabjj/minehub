import { HttpStatus } from '@nestjs/common';

/**
 * Expected business failure with a stable, frontend-facing code.
 * `message` must be safe to show to users; never put internals in it.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: HttpStatus,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const Errors = {
  validation: (details: unknown[]) => new DomainError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Alguns campos estão inválidos.', details),
  unauthorized: () => new DomainError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED, 'Faça login para continuar.'),
  invalidCredentials: () => new DomainError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED, 'E-mail ou senha incorretos.'),
  sessionExpired: () => new DomainError('SESSION_EXPIRED', HttpStatus.UNAUTHORIZED, 'Sua sessão expirou. Entre novamente.'),
  emailInUse: () => new DomainError('EMAIL_IN_USE', HttpStatus.CONFLICT, 'Já existe uma conta com esse e-mail.'),
  forbiddenOrigin: () => new DomainError('FORBIDDEN_ORIGIN', HttpStatus.FORBIDDEN, 'Origem da requisição não permitida.'),
  notFound: (what = 'Recurso') => new DomainError('NOT_FOUND', HttpStatus.NOT_FOUND, `${what} não encontrado.`),
} as const;
