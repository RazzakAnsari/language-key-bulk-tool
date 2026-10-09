import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoaderService } from '../../services/loader.service';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (loader.visible()) {
      <div class="app-loader" aria-live="polite" aria-busy="true">
        <div class="app-loader-card">
          <span class="spinner" aria-hidden="true"></span>
          <p>{{ loader.message() }}</p>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .app-loader {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        background: rgba(15, 23, 42, 0.35);
        backdrop-filter: blur(2px);
      }
      .app-loader-card {
        background: #fff;
        border-radius: 14px;
        padding: 22px 28px;
        min-width: 200px;
        display: grid;
        justify-items: center;
        gap: 12px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2);
      }
      .app-loader-card p {
        margin: 0;
        color: #334155;
        font-size: 0.9rem;
        font-weight: 500;
      }
      .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid #e2e8f0;
        border-top-color: #0f766e;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class LoaderComponent {
  readonly loader = inject(LoaderService);
}
