import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { catchError } from "rxjs/operators";
import { SentryService, scrubUrl } from "./sentry.service";

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

        // Get request context.
        //
        // Route params and query values are caller-controlled and routinely
        // carry identity (`?email=`, `?invite=`, a signed token). They are
        // reported as *key names only*: knowing which parameters were present
        // is what makes a stack trace reproducible, the values are what makes
        // it a disclosure. `request.url` is truncated at the `?` for the same
        // reason — `scrubSentryEvent` matches top-level keys and would not see
        // an email nested inside a `query` object or embedded in a URL.
        const request = context.switchToHttp().getRequest();
        const requestContext = {
          // scrubUrl, not just a `?` cut: the query was already dropped here,
          // but a path-borne credential (/calendar/feed/<token>.ics) was not.
          url: scrubUrl(String(request.url ?? "")),
          method: request.method,
          paramKeys: Object.keys(request.params ?? {}),
          queryKeys: Object.keys(request.query ?? {}),
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
