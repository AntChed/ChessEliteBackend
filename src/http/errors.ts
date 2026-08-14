import type { ErrorRequestHandler, Request, Response } from 'express';

export type ApiErrorCode =
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED';

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
  };
};

export function sendApiError(response: Response, status: number, code: ApiErrorCode, message: string) {
  response.status(status).json({
    error: {
      code,
      message,
    },
  } satisfies ApiErrorResponse);
}

export function notFoundHandler(request: Request, response: Response) {
  sendApiError(response, 404, 'NOT_FOUND', `Route ${request.method} ${request.path} not found`);
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);
  sendApiError(response, 500, 'INTERNAL_ERROR', 'Internal server error');
};

