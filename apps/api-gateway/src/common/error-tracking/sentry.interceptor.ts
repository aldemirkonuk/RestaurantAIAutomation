import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { catchError } from "rxjs/operators";
import { SentryService } from "./sentry.service";

/**
 * Sentry Interceptor
 *
 * Automatically captures exceptions from controllers:
 * - Captures unhandled exceptions
 * - Adds request context
 * - Filters HTTP exceptions (4xx errors)
 */
@Injectable()
export class SentryInterceptor implements NestInterceptor {
  constructor(private readonly sentryService: SentryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        // Don't report client errors (4xx) to Sentry
        if (error instanceof HttpException && error.getStatus() < 500) {
          return throwError(() => error);
        }

        // Get request context
        const request = context.switchToHttp().getRequest();
        const requestContext = {
          url: request.url,
          method: request.method,
          params: request.params,
          query: request.query,
          userId: request.user?.id,
          restaurantId: request.user?.restaurantId,
        };

        // Capture the exception
        this.sentryService.captureException(error, requestContext);

        return throwError(() => error);
      }),
    );
  }
}
