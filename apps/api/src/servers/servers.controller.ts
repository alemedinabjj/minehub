import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  consoleCommandRequestSchema,
  playerActionRequestSchema,
  serverLogsQuerySchema,
  updateServerRequestSchema,
  type ConsoleCommandRequest,
  type PlayerActionRequest,
  type UpdateServerRequest,
  createServerRequestSchema,
  listServerEventsQuerySchema,
  listServersQuerySchema,
  type CreateServerAccepted,
  type CreateServerRequest,
  type ListServerEventsQuery,
  type ListServersQuery,
} from '@hubmine/shared';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../common/auth/auth.decorators.js';
import { IdempotencyKey } from '../common/validation/idempotency-key.js';
import { ZodPipe } from '../common/validation/zod.pipe.js';
import { ServerPanelService, type PanelContext } from './server-panel.service.js';
import { ServersService, type ServerAction } from './servers.service.js';

const uuid = new ParseUUIDPipe();
const LIFECYCLE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('servers')
export class ServersController {
  constructor(
    private readonly servers: ServersService,
    private readonly panel: ServerPanelService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(createServerRequestSchema)) body: CreateServerRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateServerAccepted> {
    return withLocation(res, await this.servers.create(body, { userId: user.id, idempotencyKey, correlationId: requestId(req) }));
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query(new ZodPipe(listServersQuerySchema)) query: ListServersQuery) {
    return this.servers.list(user.id, query);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return { data: await this.servers.get(user.id, id) };
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(LIFECYCLE_THROTTLE)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.act('start', user, id, idempotencyKey, req, res);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(LIFECYCLE_THROTTLE)
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.act('stop', user, id, idempotencyKey, req, res);
  }

  @Post(':id/restart')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(LIFECYCLE_THROTTLE)
  restart(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.act('restart', user, id, idempotencyKey, req, res);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(LIFECYCLE_THROTTLE)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.act('delete', user, id, idempotencyKey, req, res);
  }

  @Get(':id/operations/:operationId')
  async operation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Param('operationId', uuid) operationId: string,
  ) {
    return { data: await this.servers.getOperation(user.id, id, operationId) };
  }

  @Get(':id/events')
  async events(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(listServerEventsQuerySchema)) query: ListServerEventsQuery,
  ) {
    return { data: await this.servers.listEvents(user.id, id, query) };
  }

  @Get(':id/details')
  async details(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return { data: await this.panel.details(user.id, id) };
  }

  @Patch(':id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateServerRequestSchema)) body: UpdateServerRequest,
    @Req() req: Request,
  ) {
    return { data: await this.panel.update(panelContext(user, req), id, body) };
  }

  @Post(':id/console')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async console(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(consoleCommandRequestSchema)) body: ConsoleCommandRequest,
    @Req() req: Request,
  ) {
    return { data: await this.panel.console(panelContext(user, req), id, body.command) };
  }

  @Post(':id/players/actions')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async playerAction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(playerActionRequestSchema)) body: PlayerActionRequest,
    @Req() req: Request,
  ) {
    return { data: await this.panel.playerAction(panelContext(user, req), id, body) };
  }

  @Get(':id/logs')
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  async logs(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string, @Query(new ZodPipe(serverLogsQuerySchema)) query: { tail: number }) {
    return { data: await this.panel.logs(user.id, id, query.tail) };
  }

  @Get(':id/players')
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  async players(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return { data: await this.panel.players(user.id, id) };
  }

  @Get(':id/stats')
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  async stats(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return { data: await this.panel.stats(user.id, id) };
  }

  private async act(action: ServerAction, user: AuthenticatedUser, id: string, idempotencyKey: string | undefined, req: Request, res: Response) {
    return withLocation(res, await this.servers.request(action, id, { userId: user.id, idempotencyKey, correlationId: requestId(req) }));
  }
}

function withLocation(res: Response, accepted: CreateServerAccepted): CreateServerAccepted {
  const { server, operation } = accepted.data;
  res.setHeader('Location', `/servers/${server.id}/operations/${operation.id}`);
  return accepted;
}

function panelContext(user: AuthenticatedUser, req: Request & { id?: unknown }): PanelContext {
  return { userId: user.id, ip: req.ip ?? null, requestId: typeof req.id === 'string' ? req.id : null };
}

function requestId(req: Request & { id?: unknown }): string | undefined {
  return typeof req.id === 'string' ? req.id : undefined;
}
