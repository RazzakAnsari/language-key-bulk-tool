import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import {
  Subject,
  catchError,
  finalize,
  switchMap,
  take,
  throwError,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import { CryptoUtil } from '../crypto.util';
import { AuthService } from '../services/auth.service';

/** Shared refresh gate — same idea as MasterAdmin InterceptLoader */
let refreshInProgress = false;
const refreshDone$ = new Subject<void>();

function isSkipUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes('/cursor-translate') ||
    u.includes('localhost:4310') ||
    u.includes('/openai-api/') ||
    u.includes('api.openai.com') ||
    u.includes('/gemini-api/') ||
    u.includes('generativelanguage.googleapis.com') ||
    u.includes('/gtx-api/') ||
    u.includes('translate.googleapis.com') ||
    u.includes('/mymemory-api/') ||
    u.includes('mymemory.translated.net')
  );
}

function isRefreshUrl(url: string): boolean {
  return url.toLowerCase().includes('/jwt/refreshtoken');
}

function isLogoutLogUrl(url: string): boolean {
  return url.toLowerCase().includes('/log/savelogoutlog');
}

function isServerTimeUrl(url: string): boolean {
  return url.includes('/Server/GetServerUTCTime');
}

function isLoginUrl(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('/login/validatestafflogin') || u.includes('/otp/verifyotp');
}

function withAuthHeaders(req: HttpRequest<unknown>, auth: AuthService): HttpRequest<unknown> {
  const token = CryptoUtil.buildDomainToken(environment.masterDomain, auth.getAdjustedLocalTime());
  const jwt = auth.getJwt();
  const headers: Record<string, string> = { token };
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  }
  if (!isRefreshUrl(req.url) && !isLogoutLogUrl(req.url) && !isServerTimeUrl(req.url)) {
    auth.touchLastEndpointCall();
  }
  return req.clone({ setHeaders: headers });
}

function handleUnauthorized(err: HttpErrorResponse, auth: AuthService): void {
  const type = err.error?.AuthResponseType;
  // MasterAdmin: types 1,2,4,5,6,7,8 → loginOut
  if ([1, 2, 4, 5, 6, 7, 8].includes(Number(type)) || err.status === 401) {
    auth.loginOut();
  }
}

/**
 * MasterAdmin-style auth interceptor:
 * - RSA domain token + Bearer JWT
 * - Sync UGT once
 * - Auto refresh JWT near expiry
 * - 401 → loginOut (+ SaveLogoutLog)
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (isSkipUrl(req.url)) {
    return next(req);
  }

  // Login / OTP: domain token only
  if (isLoginUrl(req.url)) {
    const token = CryptoUtil.buildDomainToken(environment.masterDomain, auth.getAdjustedLocalTime());
    return next(req.clone({ setHeaders: { token } }));
  }

  // Internal auth plumbing — never wait on refresh gate (avoids deadlock)
  if (isRefreshUrl(req.url) || isLogoutLogUrl(req.url) || isServerTimeUrl(req.url)) {
    return next(withAuthHeaders(req, auth)).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401 && isLogoutLogUrl(req.url)) {
          auth.removeSessionUserLogin();
        }
        return throwError(() => err);
      }),
    );
  }

  const needsServerTime = !sessionStorage.getItem('UGT');
  const needsRefresh =
    auth.isJwtExpiredOrNear() && !!sessionStorage.getItem('JwtToken');

  if (needsServerTime || needsRefresh) {
    if (refreshInProgress) {
      return refreshDone$.pipe(
        take(1),
        switchMap(() => next(withAuthHeaders(req, auth))),
      );
    }

    refreshInProgress = true;

    const pipeline$ = needsServerTime
      ? auth.syncServerTime().pipe(
          switchMap(() => {
            if (auth.isJwtExpiredOrNear() && sessionStorage.getItem('JwtToken')) {
              return auth.refreshToken().pipe(
                switchMap((ok) => {
                  if (!ok) return throwError(() => new Error('JWT refresh failed'));
                  return next(withAuthHeaders(req, auth));
                }),
              );
            }
            return next(withAuthHeaders(req, auth));
          }),
        )
      : auth.refreshToken().pipe(
          switchMap((ok) => {
            if (!ok) return throwError(() => new Error('JWT refresh failed'));
            return next(withAuthHeaders(req, auth));
          }),
        );

    return pipeline$.pipe(
      finalize(() => {
        refreshInProgress = false;
        refreshDone$.next();
      }),
      catchError((err) => throwError(() => err)),
    );
  }

  return next(withAuthHeaders(req, auth)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        handleUnauthorized(err, auth);
      }
      return throwError(() => err);
    }),
  );
};
