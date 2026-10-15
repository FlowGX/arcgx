/// <reference types="vite/client" />

declare global {
  interface Window {
    arcgx: {
      desktop: import('@arcgx/shared').DesktopApi;
      overlay: import('@arcgx/shared').OverlayApi;
    };
  }
}

export {};