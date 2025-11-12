// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * Toast: Non-blocking notification system
 * Architecture: Obsidian-styled toast notifications for user feedback
 */

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number; // milliseconds, 0 for persistent
  action?: {
    label: string;
    callback: () => void;
  };
}

export class Toast {
  private container: HTMLElement | null = null;
  private activeToasts: Set<HTMLElement> = new Set();

  constructor() {
    this.initContainer();
  }

  /**
   * Initialize toast container
   */
  private initContainer(): void {
    this.container = document.createElement('div');
    this.container.addClass('zeddal-toast-container');
    document.body.appendChild(this.container);
  }

  /**
   * Show a toast notification
   */
  show(options: ToastOptions): void {
    if (!this.container) {
      this.initContainer();
    }

    const {
      message,
      type = 'info',
      duration = 4000,
      action,
    } = options;

    const toast = this.createToast(message, type, action);
    this.container!.appendChild(toast);
    this.activeToasts.add(toast);

    // Trigger animation
    setTimeout(() => toast.addClass('zeddal-toast-show'), 10);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }
  }

  /**
   * Show info toast
   */
  info(message: string, duration?: number): void {
    this.show({ message, type: 'info', duration });
  }

  /**
   * Show success toast
   */
  success(message: string, duration?: number): void {
    this.show({ message, type: 'success', duration });
  }

  /**
   * Show warning toast
   */
  warning(message: string, duration?: number): void {
    this.show({ message, type: 'warning', duration });
  }

  /**
   * Show error toast
   */
  error(message: string, duration?: number): void {
    this.show({ message, type: 'error', duration });
  }

  /**
   * Create toast element
   */
  private createToast(
    message: string,
    type: ToastType,
    action?: ToastOptions['action']
  ): HTMLElement {
    const toast = document.createElement('div');
    toast.addClass('zeddal-toast', `zeddal-toast-${type}`);

    // Icon
    const icon = this.getIconForType(type);
    const iconEl = document.createElement('span');
    iconEl.addClass('zeddal-toast-icon');
    iconEl.textContent = icon;
    toast.appendChild(iconEl);

    // Message
    const messageEl = document.createElement('span');
    messageEl.addClass('zeddal-toast-message');
    messageEl.textContent = message;
    toast.appendChild(messageEl);

    // Action button
    if (action) {
      const actionBtn = document.createElement('button');
      actionBtn.addClass('zeddal-toast-action');
      actionBtn.textContent = action.label;
      actionBtn.onclick = () => {
        action.callback();
        this.dismiss(toast);
      };
      toast.appendChild(actionBtn);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.addClass('zeddal-toast-close');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.dismiss(toast);
    toast.appendChild(closeBtn);

    return toast;
  }

  /**
   * Dismiss a toast
   */
  private dismiss(toast: HTMLElement): void {
    if (!this.activeToasts.has(toast)) return;

    toast.removeClass('zeddal-toast-show');
    toast.addClass('zeddal-toast-hide');

    setTimeout(() => {
      toast.remove();
      this.activeToasts.delete(toast);
    }, 300); // Match CSS transition duration
  }

  /**
   * Get icon for toast type
   */
  private getIconForType(type: ToastType): string {
    switch (type) {
      case 'success':
        return '✓';
      case 'warning':
        return '⚠';
      case 'error':
        return '✕';
      default:
        return 'ℹ';
    }
  }

  /**
   * Clear all active toasts
   */
  clearAll(): void {
    this.activeToasts.forEach((toast) => this.dismiss(toast));
  }

  /**
   * Cleanup on unload
   */
  destroy(): void {
    this.clearAll();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
