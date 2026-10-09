import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoaderService {
  private readonly pending = signal(0);
  readonly message = signal('Please wait…');

  readonly visible = computed(() => this.pending() > 0);

  show(message = 'Please wait…'): void {
    this.message.set(message);
    this.pending.update((n) => n + 1);
  }

  hide(): void {
    this.pending.update((n) => Math.max(0, n - 1));
  }

  reset(): void {
    this.pending.set(0);
    this.message.set('Please wait…');
  }
}
