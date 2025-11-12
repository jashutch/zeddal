// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * EventBus: Lightweight pub/sub system for Zeddal
 * Architecture: Central event coordination for recording → transcription → refinement → merge flow
 */

import { ZeddalEvent, EventType } from './Types';

type EventCallback<T = any> = (event: ZeddalEvent<T>) => void;

export class EventBus {
  private listeners: Map<EventType, Set<EventCallback>>;

  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event type
   */
  on<T = any>(eventType: EventType, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }

    this.listeners.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => this.off(eventType, callback);
  }

  /**
   * Unsubscribe from an event type
   */
  off(eventType: EventType, callback: EventCallback): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   */
  emit<T = any>(eventType: EventType, data: T): void {
    const event: ZeddalEvent<T> = {
      type: eventType,
      data,
      timestamp: Date.now(),
    };

    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error(`Error in event listener for ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * Subscribe to an event once, then auto-unsubscribe
   */
  once<T = any>(eventType: EventType, callback: EventCallback<T>): void {
    const wrappedCallback = (event: ZeddalEvent<T>) => {
      callback(event);
      this.off(eventType, wrappedCallback);
    };
    this.on(eventType, wrappedCallback);
  }

  /**
   * Clear all listeners for a specific event type or all events
   */
  clear(eventType?: EventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }
}

// Global singleton instance
export const eventBus = new EventBus();
