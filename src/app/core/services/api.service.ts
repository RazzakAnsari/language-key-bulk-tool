import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private masterHeaders(): HttpHeaders {
    return new HttpHeaders({
      ClientId: environment.clientId,
      LoggedInUser: this.auth.getStaffId() || '',
      'Content-Type': 'application/json; charset=utf-8',
    });
  }

  masterGet<T = any>(url: string): Observable<T> {
    return this.http.get<T>(`${environment.MasterAPIBaseUrl}${url}`, {
      headers: this.masterHeaders(),
    });
  }

  masterPost<T = any>(url: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${environment.MasterAPIBaseUrl}${url}`, body, {
      headers: this.masterHeaders(),
    });
  }
}
