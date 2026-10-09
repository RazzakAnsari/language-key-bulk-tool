import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LoaderService } from '../../shared/services/loader.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly loader = inject(LoaderService);

  showPassword = false;
  loading = signal(false);
  error = signal('');
  otpMode = signal(false);
  otpUserId = signal('');
  showImport = signal(false);

  readonly loginForm = this.fb.nonNullable.group({
    email: ['razzak@infohybrid.com', [Validators.required, Validators.email]],
    password: ['Razzak@123', Validators.required],
  });

  readonly otpForm = this.fb.nonNullable.group({
    otp: ['', [Validators.required, Validators.minLength(4)]],
  });

  readonly importForm = this.fb.nonNullable.group({
    jwtToken: ['', Validators.required],
    refreshToken: [''],
    jwtTokenExpiry: [''],
    staffUserId: ['', Validators.required],
    firstName: [''],
    email: [''],
  });

  ngOnInit(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/workspace');
      return;
    }
    this.auth.syncServerTime().subscribe();
  }

  submit(): void {
    this.error.set('');
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.error.set('Email and password are required');
      this.toast.err('Email and password are required');
      return;
    }
    const { email, password } = this.loginForm.getRawValue();
    this.loading.set(true);
    this.loader.show('Signing in…');
    this.auth.login(email.trim(), password).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.loader.hide();
        if (res.needsOtp && res.userId) {
          this.otpMode.set(true);
          this.otpUserId.set(res.userId);
          this.error.set(res.message);
          this.toast.info(res.message || 'Enter OTP');
          return;
        }
        if (!res.ok) {
          this.error.set(res.message);
          this.toast.err(res.message || 'Login failed');
          return;
        }
        this.toast.ok('Signed in');
        this.router.navigateByUrl('/workspace');
      },
      error: () => {
        this.loading.set(false);
        this.loader.hide();
        this.error.set('Unexpected login error');
        this.toast.err('Unexpected login error');
      },
    });
  }

  verifyOtp(): void {
    this.error.set('');
    if (this.otpForm.invalid) {
      this.otpForm.markAllAsTouched();
      this.error.set('Enter valid OTP');
      this.toast.err('Enter valid OTP');
      return;
    }
    this.loading.set(true);
    this.loader.show('Verifying OTP…');
    this.auth.verifyOtp(this.otpUserId(), this.otpForm.controls.otp.value.trim()).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.loader.hide();
        if (!res.ok) {
          this.error.set(res.message);
          this.toast.err(res.message || 'OTP verification failed');
          return;
        }
        this.toast.ok('OTP verified');
        this.router.navigateByUrl('/workspace');
      },
      error: () => {
        this.loading.set(false);
        this.loader.hide();
        this.error.set('OTP verification failed');
        this.toast.err('OTP verification failed');
      },
    });
  }

  importSession(): void {
    this.error.set('');
    if (this.importForm.invalid) {
      this.importForm.markAllAsTouched();
      this.error.set('JwtToken and StaffuserId are required');
      this.toast.err('JwtToken and StaffuserId are required');
      return;
    }
    const v = this.importForm.getRawValue();
    const res = this.auth.importSession({
      jwtToken: v.jwtToken,
      refreshToken: v.refreshToken,
      jwtTokenExpiry: v.jwtTokenExpiry,
      staffUserId: v.staffUserId,
      firstName: v.firstName,
      email: v.email || this.loginForm.controls.email.value,
    });
    if (!res.ok) {
      this.error.set(res.message);
      this.toast.err(res.message || 'Import failed');
      return;
    }
    this.toast.ok('Session imported');
    this.router.navigateByUrl('/workspace');
  }
}
