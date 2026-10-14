import type { ApiErrorBody } from '@vep/core';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: string[];

  constructor(statusCode: number, code: string, message: string, details?: string[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, details?: string[]) =>
  new HttpError(400, 'bad_request', message, details);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export function errorHandler(
  error: FastifyError | HttpError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof HttpError) {
    const body: ApiErrorBody = {
      error: error.code,
      message: error.message,
      details: error.details,
    };
    void reply.status(error.statusCode).send(body);
    return;
  }
  const fastifyError = error as FastifyError;
  const status = fastifyError.statusCode ?? 500;
  if (status >= 500) request.log.error(error);
  const body: ApiErrorBody = {
    error: status >= 500 ? 'internal_error' : (fastifyError.code ?? 'request_error'),
    message: status >= 500 ? 'Something went wrong on the server.' : error.message,
  };
  void reply.status(status).send(body);
}
