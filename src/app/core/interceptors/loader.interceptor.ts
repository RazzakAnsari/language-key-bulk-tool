import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { LoaderService } from '../../shared/services/loader.service';

function shouldSkipLoader(url: string): boolean {
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
    u.includes('mymemory.translated.net') ||
    u.includes('/server/getserverutctime') ||
    u.includes('/jwt/refreshtoken') ||
    u.includes('/login/validatestafflogin') ||
    u.includes('/otp/verifyotp')
  );
}

/** Master-admin style: show global loader while Master API calls are pending. */
export const loaderInterceptor: HttpInterceptorFn = (req, next) => {
  if (shouldSkipLoader(req.url)) {
    return next(req);
  }

  const loader = inject(LoaderService);
  loader.show('Loading…');
  return next(req).pipe(finalize(() => loader.hide()));
};
