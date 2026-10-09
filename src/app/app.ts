import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LoaderComponent } from './shared/components/loader/loader.component';
import { ToastComponent } from './shared/components/toast/toast.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoaderComponent, ToastComponent],
  template: `
    <router-outlet />
    <app-loader />
    <app-toast />
  `,
  styles: `:host { display: block; min-height: 100vh; }`,
})
export class App {}
