/** One frame of movement intent, consumed by the DOM-free simulation. */
export interface InputFrame {
  moveX: number;
  moveY: number;
}

export interface JoystickState {
  active: boolean;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

const JOY_RADIUS = 56;

/**
 * Keyboard (WASD + arrows) and a virtual touch joystick on the left half of
 * the screen. All pressed-key state is cleared on window blur so keys never
 * stick after alt-tab.
 */
export class Input {
  /** Exposed for the renderer to draw the joystick. */
  readonly joystick: JoystickState = { active: false, originX: 0, originY: 0, x: 0, y: 0 };

  private readonly keys = new Set<string>();
  private readonly keyHandlers = new Map<string, () => void>();
  private joyPointerId = -1;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const handler = this.keyHandlers.get(e.code);
      if (handler) {
        e.preventDefault();
        handler();
      }
      if (SCROLL_KEYS.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.clientX > window.innerWidth / 2) return;
      // One pointer owns the joystick: a second finger resting on the left
      // half must not steal (and, on release, kill) the player's movement.
      if (this.joyPointerId !== -1) return;
      this.joyPointerId = e.pointerId;
      this.joystick.active = true;
      this.joystick.originX = e.clientX;
      this.joystick.originY = e.clientY;
      this.joystick.x = e.clientX;
      this.joystick.y = e.clientY;
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyPointerId) return;
      this.joystick.x = e.clientX;
      this.joystick.y = e.clientY;
    });
    const endJoy = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyPointerId) return;
      this.joyPointerId = -1;
      this.joystick.active = false;
    };
    target.addEventListener('pointerup', endJoy);
    target.addEventListener('pointercancel', endJoy);
  }

  /** Registers a handler fired once per physical key press (no auto-repeat). */
  onKey(code: string, handler: () => void): void {
    this.keyHandlers.set(code, handler);
  }

  /** Writes the current movement vector (normalized, magnitude <= 1) into `out`. */
  frame(out: InputFrame): InputFrame {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;

    if (this.joystick.active) {
      const dx = this.joystick.x - this.joystick.originX;
      const dy = this.joystick.y - this.joystick.originY;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        const scale = Math.min(1, len / JOY_RADIUS) / len;
        x = dx * scale;
        y = dy * scale;
      } else {
        x = 0;
        y = 0;
      }
    } else {
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
    }

    out.moveX = x;
    out.moveY = y;
    return out;
  }

  clear(): void {
    this.keys.clear();
    this.joyPointerId = -1;
    this.joystick.active = false;
  }
}

const SCROLL_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
]);
