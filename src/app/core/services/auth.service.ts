import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, Subscription, catchError, interval, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CryptoUtil } from '../crypto.util';
import { LoginDetails } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly isLoggedIn = signal(this.readLoggedIn());
  readonly userName = signal(this.readUserName());

  private jwtTimerSub?: Subscription;

  getAdjustedLocalTime(): number {
    const offset = sessionStorage.getItem('UGT') || '0';
    return Date.now() + (parseInt(offset, 10) || 0);
  }

  /** Same as MasterAdmin SetuserLocalGapTime — uses server_utc_time ms */
  syncServerTime(): Observable<boolean> {
    return this.http.get<any>(`${environment.MasterAPIGoBaseUrl}/Server/GetServerUTCTime`).pipe(
      tap((res) => {
        const serverMs = Number(
          res?.server_utc_time ?? res?.Result?.server_utc_time ?? res?.Result ?? res?.result ?? 0,
        );
        if (serverMs > 0) {
          sessionStorage.setItem('UGT', String(serverMs - Date.now()));
        } else {
          sessionStorage.setItem('UGT', '0');
        }
      }),
      map(() => true),
      catchError(() => {
        sessionStorage.setItem('UGT', '0');
        return of(true);
      }),
    );
  }

  login(email: string, password: string): Observable<{ ok: boolean; message: string; needsOtp?: boolean; userId?: string }> {
    const postData = {
      EmailID: email,
      Password: password,
      Browser: this.getBrowserName(),
      City: '',
      CountryCode: '',
      IP: '127.0.0.1',
      Lon: 0,
      Lat: 0,
      Proxy: false,
      Platform: this.getPlatform(),
      MachineId: localStorage.getItem('MasterMacId') || localStorage.getItem('MacId') || '',
      time: (this.getAdjustedLocalTime() * 10000 + 621355968000000000).toString(),
    };

    const encryptedKey = CryptoUtil.encryptRSA(CryptoUtil.rsaPublicKey, JSON.stringify(postData));
    if (!encryptedKey) {
      return of({
        ok: false,
        message: 'RSA encrypt failed for login payload. Try Session Import from Master Admin instead.',
      });
    }

    const headers = new HttpHeaders({
      token: CryptoUtil.buildDomainToken(environment.masterDomain, this.getAdjustedLocalTime()),
      ClientId: environment.clientId,
      Referer: `https://${environment.masterDomain}`,
    });

    return this.http
      .post<any>(`${environment.MasterAPIBaseUrl}/Login/ValidateStaffLogin`, { key: encryptedKey }, { headers })
      .pipe(
        map((res) => {
          if (!res?.Status) {
            const msg = res?.Message || 'Login failed';
            if (String(msg).toLowerCase().includes('orgid')) {
              return {
                ok: false,
                message: msg + ' — Login at Master Admin first, or use Session Import.',
              };
            }
            return { ok: false, message: msg };
          }
          if (res.ResponseObject?.is_mfa_applicable) {
            return {
              ok: false,
              needsOtp: true,
              userId: res.ResponseObject.staff_master_id,
              message: 'OTP required.',
            };
          }
          this.persistSession(res);
          return { ok: true, message: res.Message || 'Login successful' };
        }),
        catchError((err) =>
          of({
            ok: false,
            message: err?.error?.Message || err?.message || 'Login request failed',
          }),
        ),
      );
  }

  importSession(input: {
    jwtToken: string;
    refreshToken: string;
    jwtTokenExpiry: string;
    staffUserId: string;
    firstName?: string;
    email?: string;
  }): { ok: boolean; message: string } {
    if (!input.jwtToken?.trim() || !input.staffUserId?.trim()) {
      return { ok: false, message: 'JwtToken and StaffuserId are required' };
    }
    sessionStorage.setItem('StaffuserId', input.staffUserId.trim());
    sessionStorage.setItem('JwtToken', input.jwtToken.trim());
    sessionStorage.setItem('RefreshToken', (input.refreshToken || '').trim());
    sessionStorage.setItem('JwtTokenExpiry', (input.jwtTokenExpiry || '').trim());
    const details: LoginDetails = {
      FirstName: input.firstName || 'Staff',
      LastLogin: '',
      IsLoggedIn: true,
      StaffId: input.staffUserId.trim(),
      StaffEmailId: input.email || '',
    };
    CryptoUtil.setSessionStorage('LoginDetails', JSON.stringify(details));
    this.isLoggedIn.set(true);
    this.userName.set(details.FirstName || details.StaffEmailId);
    this.startJwtTimer();
    return { ok: true, message: 'Session imported' };
  }

  verifyOtp(userId: string, otp: string): Observable<{ ok: boolean; message: string }> {
    const postData = {
      oTP: otp,
      userId,
      browser: this.getBrowserName(),
      city: '',
      countryCode: '',
      iP: '',
      lon: '',
      lat: '',
      proxy: false,
      platform: this.getPlatform(),
      macId: localStorage.getItem('MacId') || '',
    };
    return this.http.post<any>(`${environment.MasterAPIBaseUrl}/OTP/VerifyOTP`, postData).pipe(
      map((res) => {
        if (!res?.Status) {
          return { ok: false, message: res?.Message || 'OTP verification failed' };
        }
        this.persistSession(res);
        return { ok: true, message: res.Message || 'Login successful' };
      }),
      catchError((err) =>
        of({ ok: false, message: err?.error?.Message || err?.message || 'OTP failed' }),
      ),
    );
  }

  /** MasterAdmin-style refresh: POST /JWT/RefreshToken */
  refreshToken(): Observable<boolean> {
    const postData = {
      JwtToken: sessionStorage.getItem('JwtToken'),
      RefreshToken: sessionStorage.getItem('RefreshToken'),
    };
    return this.http
      .post<any>(`${environment.MasterAPIBaseUrl}/JWT/RefreshToken`, postData, {
        headers: {
          ClientId: environment.clientId,
          LoggedInUser: this.getStaffId() || '',
          'Content-Type': 'application/json; charset=utf-8',
        },
      })
      .pipe(
        map((res) => {
          if (!res?.Status) {
            this.loginOut();
            return false;
          }
          sessionStorage.setItem('JwtToken', res.JwtToken);
          sessionStorage.setItem('RefreshToken', res.RefreshToken);
          sessionStorage.setItem('JwtTokenExpiry', res.JwtTokenExpiry);
          return true;
        }),
        catchError(() => {
          this.loginOut();
          return of(false);
        }),
      );
  }

  /** True when JWT is expired / within 3 seconds of expiry (same as MasterAdmin interceptor) */
  isJwtExpiredOrNear(): boolean {
    const expiryMs = this.parseUtcMs(sessionStorage.getItem('JwtTokenExpiry')) - 3000;
    if (!expiryMs) return !!sessionStorage.getItem('JwtToken');
    return expiryMs < this.getAdjustedLocalTime();
  }

  /**
   * Proactive refresh like MasterAdmin StartJWTTimer:
   * when <= 2 minutes left and user was recently active → refresh.
   */
  startJwtTimer(): void {
    this.stopJwtTimer();
    if (!sessionStorage.getItem('JwtToken')) return;

    this.jwtTimerSub = interval(1000).subscribe(() => {
      const expiryMs = this.parseUtcMs(sessionStorage.getItem('JwtTokenExpiry'));
      if (!expiryMs) return;

      const current = this.getAdjustedLocalTime();
      const timeDifference = expiryMs - current;
      const lastCall = this.parseUtcMs(sessionStorage.getItem('LastEndpointCallTime')) || current;
      const idleMs = current - lastCall;

      // Expired → logout
      if (timeDifference <= 0) {
        this.loginOut();
        return;
      }

      // Within 2 minutes of expiry and recently active (< 13 min idle) → extend
      if (timeDifference <= 120_000 && idleMs < 780_000) {
        this.stopJwtTimer();
        this.refreshToken().subscribe((ok) => {
          if (ok) this.startJwtTimer();
        });
      }
    });
  }

  stopJwtTimer(): void {
    this.jwtTimerSub?.unsubscribe();
    this.jwtTimerSub = undefined;
  }

  /**
   * MasterAdmin loginOut — SaveLogoutLog then clear session.
   * Workspace Logout button should call this.
   */
  loginOut(): void {
    this.stopJwtTimer();
    const staffId = sessionStorage.getItem('StaffuserId');
    let ipPayload: Record<string, unknown> = {};
    try {
      const raw = CryptoUtil.getSessionStorage('i');
      if (raw) ipPayload = JSON.parse(raw);
    } catch {
      /* ignore */
    }

    const userLogModel = {
      ip: ipPayload['iP'] || ipPayload['IP'] || '',
      ip_city: ipPayload['city'] || '',
      ip_country_code: ipPayload['countryCode'] || '',
      ip_lat: ipPayload['lat'] || '',
      ip_lon: ipPayload['lon'] || '',
      ip_proxy: ipPayload['proxy'] || false,
      staff_master_id: staffId,
    };

    const finish = () => this.removeSessionUserLogin();

    if (!staffId) {
      finish();
      return;
    }

    this.http.post(`${environment.MasterAPIBaseUrl}/Log/SaveLogoutLog`, userLogModel).subscribe({
      next: () => finish(),
      error: () => finish(),
    });
  }

  /** Alias used by UI */
  logout(): void {
    this.loginOut();
  }

  removeSessionUserLogin(): void {
    this.stopJwtTimer();
    sessionStorage.clear();
    this.isLoggedIn.set(false);
    this.userName.set('');
    this.router.navigateByUrl('/login');
  }

  getJwt(): string | null {
    return sessionStorage.getItem('JwtToken');
  }

  getStaffId(): string | null {
    return sessionStorage.getItem('StaffuserId');
  }

  touchLastEndpointCall(): void {
    const adjusted = this.getAdjustedLocalTime();
    sessionStorage.setItem('LastEndpointCallTime', this.formatUtc(adjusted));
  }

  private persistSession(res: any): void {
    if (res.MachineId && res.MachineId !== 'null') {
      localStorage.setItem('MacId', res.MachineId);
    }
    sessionStorage.setItem('StaffuserId', res.ResponseObject.staff_master_id);
    sessionStorage.setItem('JwtToken', res.JwtToken);
    sessionStorage.setItem('RefreshToken', res.RefreshToken);
    sessionStorage.setItem('JwtTokenExpiry', res.JwtTokenExpiry);

    const details: LoginDetails = {
      FirstName: res.ResponseObject.first_name,
      LastLogin: res.ResponseObject.last_login || '',
      IsLoggedIn: true,
      StaffId: res.ResponseObject.staff_master_id,
      StaffEmailId: res.ResponseObject.staff_email_id,
    };
    CryptoUtil.setSessionStorage('LoginDetails', JSON.stringify(details));
    this.isLoggedIn.set(true);
    this.userName.set(details.FirstName || details.StaffEmailId);
    this.touchLastEndpointCall();
    this.startJwtTimer();
  }

  private readLoggedIn(): boolean {
    try {
      const raw = CryptoUtil.getSessionStorage('LoginDetails');
      if (!raw) return false;
      const details = JSON.parse(raw) as LoginDetails;
      return !!details?.IsLoggedIn && !!sessionStorage.getItem('JwtToken');
    } catch {
      return false;
    }
  }

  private readUserName(): string {
    try {
      const raw = CryptoUtil.getSessionStorage('LoginDetails');
      if (!raw) return '';
      const details = JSON.parse(raw) as LoginDetails;
      return details.FirstName || details.StaffEmailId || '';
    } catch {
      return '';
    }
  }

  private parseUtcMs(value: string | null): number {
    if (!value) return 0;
    const normalized = value.includes('T') || /Z|[+-]\d{2}:?\d{2}$/.test(value)
      ? value
      : value.replace(' ', 'T') + 'Z';
    const ms = Date.parse(normalized);
    return Number.isNaN(ms) ? 0 : ms;
  }

  private formatUtc(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  private getBrowserName(): string {
    const ua = navigator.userAgent;
    if (ua.includes('Edg')) return 'Microsoft Edge';
    if (ua.includes('Chrome')) return 'Google Chrome';
    if (ua.includes('Firefox')) return 'Mozilla Firefox';
    if (ua.includes('Safari')) return 'Apple Safari';
    return 'Unknown Browser';
  }

  private getPlatform(): string {
    const ua = navigator.userAgent.toLowerCase();
    if (/win/.test(ua)) return 'Windows desktop';
    if (/mac/.test(ua)) return 'Mac desktop';
    if (/linux/.test(ua)) return 'Linux desktop';
    return 'Unknown device';
  }
}
