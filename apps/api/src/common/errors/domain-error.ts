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
  invalidIdempotencyKey: () => new DomainError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Alguns campos estão inválidos.', [{ field: 'Idempotency-Key', code: 'IDEMPOTENCY_KEY_INVALID' }]),
  serverNotFound: () => new DomainError('SERVER_NOT_FOUND', HttpStatus.NOT_FOUND, 'Servidor não encontrado.'),
  operationNotFound: () => new DomainError('OPERATION_NOT_FOUND', HttpStatus.NOT_FOUND, 'Operação não encontrada.'),
  invalidTransition: (status: string) =>
    new DomainError('SERVER_INVALID_TRANSITION', HttpStatus.CONFLICT, 'Essa ação não está disponível no estado atual do servidor.', [{ status }]),
  operationInProgress: () =>
    new DomainError('OPERATION_IN_PROGRESS', HttpStatus.CONFLICT, 'Já existe uma operação em andamento nesse servidor. Aguarde ela terminar.'),
  idempotencyKeyReused: () =>
    new DomainError('IDEMPOTENCY_KEY_REUSED', HttpStatus.UNPROCESSABLE_ENTITY, 'Essa chave de idempotência já foi usada em outra operação.'),
  serverNameInUse: () => new DomainError('SERVER_NAME_IN_USE', HttpStatus.CONFLICT, 'Você já tem um servidor com esse nome.'),
  serverQuotaExceeded: (max: number) =>
    new DomainError('SERVER_QUOTA_EXCEEDED', HttpStatus.FORBIDDEN, `Você atingiu o limite de ${max} servidores.`, [{ max }]),
  invalidSoftwareCombination: (code: string) =>
    new DomainError('INVALID_SOFTWARE_COMBINATION', HttpStatus.UNPROCESSABLE_ENTITY, 'Essa combinação de software não é suportada.', [{ code }]),
} as const;
