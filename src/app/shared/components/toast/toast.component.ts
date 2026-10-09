import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (toastSvc.toast(); as t) {
      <div class="app-toast" [class.err]="t.type === 'err'" [class.info]="t.type === 'info'" role="status">
        {{ t.text }}
      </div>
    }
  `,
  styles: [
    `
      .app-toast {
        position: fixed;
        right: 16px;
        bottom: 16px;
        background: #0f172a;
        color: #fff;
        padding: 12px 16px;
        border-radius: 10px;
        max-width: min(480px, calc(100vw - 32px));
        z-index: 10000;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.28);
        font-size: 0.9rem;
        line-height: 1.4;
        animation: toastIn 0.2s ease;
      }
      .app-toast.err {
        background: #991b1b;
      }
      .app-toast.info {
        background: #0f766e;
      }
      @keyframes toastIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class ToastComponent {
  readonly toastSvc = inject(ToastService);
}
