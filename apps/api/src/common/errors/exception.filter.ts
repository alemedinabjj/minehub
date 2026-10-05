import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { isUniqueViolation } from '@hubmine/database';
import type { Request, Response } from 'express';
import { DomainError } from './domain-error.js';

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

/**
 * The single place that turns exceptions into `{ error: { code, message, details? }, requestId }`.
 * Unknown errors become a generic 500; details go to logs only.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = typeof req.id === 'string' ? req.id : undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { code: string; message: string; details?: unknown[] } = {
      code: 'INTERNAL_ERROR',
      message: 'Algo deu errado do nosso lado. Tente novamente em instantes.',
    };

    if (exception instanceof DomainError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) };
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: 'RATE_LIMITED', message: 'Muitas tentativas seguidas. Espere um pouco e tente de novo.' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = { code: STATUS_CODES[status] ?? 'HTTP_ERROR', message: status === 404 ? 'Rota não encontrada.' : 'Requisição inválida.' };
    } else if (isUniqueViolation(exception)) {
      status = HttpStatus.CONFLICT;
      body = { code: 'CONFLICT', message: 'Esse recurso já existe.' };
    }

    if (status >= 500) this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    res.status(status).json({ error: body, requestId });
  }
}
