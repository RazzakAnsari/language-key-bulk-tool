import { Injectable, signal } from '@angular/core';

export type ToastType = 'ok' | 'err' | 'info';

export interface ToastMessage {
  type: ToastType;
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toast = signal<ToastMessage | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(type: ToastType, text: string, ms = 5500): void {
    if (this.timer) clearTimeout(this.timer);
    this.toast.set({ type, text });
    this.timer = setTimeout(() => {
      this.toast.set(null);
      this.timer = null;
    }, ms);
  }

  ok(text: string): void {
    this.show('ok', text);
  }

  err(text: string): void {
    this.show('err', text);
  }

  info(text: string): void {
    this.show('info', text);
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.toast.set(null);
  }
}
