import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  ConnectedPosition,
} from '@angular/cdk/overlay';
import { TranslatePipe } from '@ngx-translate/core';
import { clamp } from '../../util/clamp';
import {
  hexToHsv,
  hslToHex,
  hsvToHex,
  Hsv,
  isValidHexColor,
  normalizeHexColor,
} from '../../util/color.util';
import { T } from '../../t.const';

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** Fallback hue/saturation when the incoming value is not a usable color. */
const FALLBACK_HSV: Hsv = { h: 0, s: 0, v: 0 };

@Component({
  selector: 'input-color-picker',
  templateUrl: './input-color-picker.component.html',
  styleUrls: ['./input-color-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, CdkOverlayOrigin, CdkConnectedOverlay],
})
export class InputColorPickerComponent {
  readonly value = input<string>('#000000');
  readonly label = input<string>('');
  readonly valueChange = output<string>();

  readonly T = T;
  readonly isOpen = signal(false);

  /**
   * HSV is the source of truth for the panel. Hex alone cannot round-trip
   * through the picker: a grey or black color carries no hue, so dragging back
   * up from it would otherwise jump to red every time.
   */
  private readonly _hsv = signal<Hsv>(FALLBACK_HSV);
  private readonly _codeDraft = signal<string | null>(null);
  private _isDragging = false;

  readonly color = computed(() => hsvToHex(this._hsv()));
  /** Fully saturated, fully bright version of the current hue: the panel's base. */
  readonly hueColor = computed(() => hslToHex(this._hsv().h, 100, 50));
  readonly saturationPercent = computed(() => this._hsv().s);
  readonly valuePercent = computed(() => 100 - this._hsv().v);
  readonly huePercent = computed(() => this._hsv().h / 3.6);
  readonly codeValue = computed(() => this._codeDraft() ?? this.color());

  readonly viewportMargin = VIEWPORT_MARGIN;

  // Below the trigger, flipping above when there is no room.
  readonly panelPositions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: PANEL_GAP,
    },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetY: -PANEL_GAP,
    },
  ];

  constructor() {
    effect(() => {
      const incoming = this.value();
      if (!isValidHexColor(incoming)) {
        return;
      }

      const normalized = normalizeHexColor(incoming);
      untracked(() => {
        // Our own emission coming back; re-deriving it would drop the hue of greys.
        if (normalized === hsvToHex(this._hsv())) {
          return;
        }
        this._hsv.set(hexToHsv(normalized) ?? FALLBACK_HSV);
      });
    });
  }

  toggle(): void {
    this.isOpen.update((v) => !v);
  }

  onSaturationValuePointerDown(event: PointerEvent): void {
    const surface = event.currentTarget as HTMLElement;
    this._capturePointer(surface, event.pointerId);
    this._isDragging = true;
    this._applySaturationValue(event, surface);
  }

  onSaturationValuePointerMove(event: PointerEvent): void {
    if (!this._isDragging) {
      return;
    }
    this._applySaturationValue(event, event.currentTarget as HTMLElement);
  }

  onSaturationValuePointerUp(event: PointerEvent): void {
    this._endDrag(event.currentTarget as HTMLElement, event.pointerId);
  }

  onHuePointerDown(event: PointerEvent): void {
    const bar = event.currentTarget as HTMLElement;
    this._capturePointer(bar, event.pointerId);
    this._isDragging = true;
    this._applyHue(event, bar);
  }

  onHuePointerMove(event: PointerEvent): void {
    if (!this._isDragging) {
      return;
    }
    this._applyHue(event, event.currentTarget as HTMLElement);
  }

  onHuePointerUp(event: PointerEvent): void {
    this._endDrag(event.currentTarget as HTMLElement, event.pointerId);
  }

  /** Accepts a half-typed code so the field is not rewritten under the caret. */
  onCodeInput(value: string): void {
    if (!isValidHexColor(value)) {
      this._codeDraft.set(value);
      return;
    }

    const normalized = normalizeHexColor(value);
    this._codeDraft.set(value.trim() === normalized ? null : value);
    this._hsv.set(hexToHsv(normalized) ?? FALLBACK_HSV);
    this.valueChange.emit(normalized);
  }

  onCodeBlur(): void {
    this._codeDraft.set(null);
  }

  private _applySaturationValue(event: PointerEvent, surface: HTMLElement): void {
    const { x, y } = this._positionIn(event, surface);
    this._commit({ ...this._hsv(), s: x * 100, v: (1 - y) * 100 });
  }

  private _applyHue(event: PointerEvent, bar: HTMLElement): void {
    const { x } = this._positionIn(event, bar);
    this._commit({ ...this._hsv(), h: x * 360 });
  }

  private _positionIn(
    event: PointerEvent,
    element: HTMLElement,
  ): { x: number; y: number } {
    const rect = element.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 1),
    };
  }

  private _commit(next: Hsv): void {
    this._codeDraft.set(null);
    this._hsv.set(next);
    this.valueChange.emit(hsvToHex(next));
  }

  private _capturePointer(element: HTMLElement, pointerId: number): void {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointer events have no active pointer to capture; the
      // pointermove handler then just relies on the events reaching the same element.
    }
  }

  private _endDrag(element: HTMLElement, pointerId: number): void {
    this._isDragging = false;
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  }
}
