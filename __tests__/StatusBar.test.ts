import { StatusBar } from '../ui/StatusBar';
import { eventBus } from '../utils/EventBus';

class MockElement {
  tagName: string;
  textContent = '';
  children: MockElement[] = [];
  parent: MockElement | null = null;
  className = '';
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  private classSet: Set<string> = new Set();
  private listeners: Record<string, Array<(event: any) => void>> = {};
  classList = {
    add: (...tokens: string[]) => {
      tokens.forEach((token) => {
        if (token) this.classSet.add(token);
      });
      this.syncClassName();
    },
    remove: (...tokens: string[]) => {
      tokens.forEach((token) => this.classSet.delete(token));
      this.syncClassName();
    },
    contains: (token: string) => this.classSet.has(token),
  };

  constructor(tagName: string, spec?: string | { cls?: string; text?: string }) {
    this.tagName = tagName;
    this.applySpec(spec);
  }

  createDiv(spec?: string | { cls?: string; text?: string }): MockElement {
    return this.appendChild(new MockElement('div', spec));
  }

  createSpan(spec?: string | { cls?: string; text?: string }): MockElement {
    return this.appendChild(new MockElement('span', spec));
  }

  createEl(tag: string, spec?: string | { cls?: string; text?: string }): MockElement {
    return this.appendChild(new MockElement(tag, spec));
  }

  appendChild<T extends MockElement>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  empty(): void {
    this.children.forEach((child) => (child.parent = null));
    this.children = [];
    this.textContent = '';
  }

  setAttr(key: string, value: string): void {
    this.attrs[key] = value;
  }

  querySelector(): MockElement | null {
    return null;
  }

  addEventListener(type: string, callback: (event: any) => void): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(callback);
  }

  removeEventListener(type: string, callback: (event: any) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((cb) => cb !== callback);
  }

  dispatchEvent(event: any): void {
    const type = event?.type;
    if (!type) return;
    (this.listeners[type] || []).forEach((cb) => cb(event));
  }

  getBoundingClientRect(): DOMRect {
    const parse = (value?: string, fallback = 0) => {
      const parsed = value ? parseFloat(value) : NaN;
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const left = parse(this.style.left, 0);
    const top = parse(this.style.top, 0);
    const width = parse(this.style.width, 260);
    const height = parse(this.style.height, 80);
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  private syncClassName(): void {
    this.className = Array.from(this.classSet).join(' ');
  }

  private applySpec(spec?: string | { cls?: string; text?: string }): void {
    if (!spec) return;
    if (typeof spec === 'string') {
      this.classSet = new Set(spec.split(/\s+/).filter(Boolean));
      this.syncClassName();
      return;
    }
    if (spec.cls) {
      this.classSet = new Set(spec.cls.split(/\s+/).filter(Boolean));
      this.syncClassName();
    }
    if (spec.text !== undefined) {
      this.textContent = spec.text;
    }
  }
}

const setupDom = () => {
  const body = new MockElement('body');
  const docListeners: Record<string, Array<(event: any) => void>> = {};
  const fakeDocument = {
    body,
    addEventListener: (type: string, callback: (event: any) => void) => {
      docListeners[type] = docListeners[type] || [];
      docListeners[type].push(callback);
    },
    removeEventListener: (type: string, callback: (event: any) => void) => {
      docListeners[type] = (docListeners[type] || []).filter((cb) => cb !== callback);
    },
    dispatchEvent: (event: any) => {
      const type = event?.type;
      if (!type) return;
      (docListeners[type] || []).forEach((cb) => cb(event));
    },
  };
  (globalThis as any).document = fakeDocument;
  (globalThis as any).window = (globalThis as any).window || {
    innerWidth: 1200,
    innerHeight: 900,
  };
  (globalThis as any).createDiv = (spec?: string | { cls?: string; text?: string }) =>
    new MockElement('div', spec);
  return body;
};

describe('StatusBar', () => {
  let statusBar: StatusBar;
  let recordSpy: jest.Mock;

  beforeEach(() => {
    setupDom();
    recordSpy = jest.fn();
    statusBar = new StatusBar({} as any, recordSpy);
  });

  afterEach(() => {
    statusBar.destroy();
    eventBus.clear();
  });

  it('reacts to recording lifecycle events', () => {
    eventBus.emit('recording-started', {});
    expect((statusBar as any).currentState).toBe('listening');
    expect(((statusBar as any).stateText.textContent as string) ?? '').toContain('Listening');

    eventBus.emit('recording-stopped', {});
    expect((statusBar as any).currentState).toBe('processing');
    expect(((statusBar as any).stateText.textContent as string) ?? '').toContain('Processing');
  });

  it('renders telemetry snapshot totals', () => {
    statusBar.updateTelemetry({
      speakingTimeMs: 1500,
      totalRecordingTimeMs: 4200,
    });

    const metrics = ((statusBar as any).metricsText.textContent as string) ?? '';
    expect(metrics).toContain('Speaking 1.5s');
    expect(metrics).toContain('Recorded 4.2s');
  });

  it('invokes record callback when idle button clicked', () => {
    const event = {
      type: 'click',
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    ((statusBar as any).recordButton as any).dispatchEvent(event);
    expect(recordSpy).toHaveBeenCalledTimes(1);
  });

  it('disables the record button while recording', () => {
    eventBus.emit('recording-started', {});
    expect(((statusBar as any).recordButton as HTMLButtonElement).disabled).toBe(true);
    eventBus.emit('refined', {});
    expect(((statusBar as any).recordButton as HTMLButtonElement).disabled).toBe(false);
  });
});
