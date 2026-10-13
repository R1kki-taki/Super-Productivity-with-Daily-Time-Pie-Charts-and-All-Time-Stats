import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';

import { InputColorPickerComponent } from './input-color-picker.component';

const START_COLOR = '#ff0000';

/**
 * The wrapper mimics the themed dialog surface from #9423: `backdrop-filter`
 * makes an element the containing block for fixed-position descendants, so a
 * panel positioned with viewport coordinates lands offset by the wrapper's own
 * origin. Three built-in themes do exactly this to `.mat-mdc-dialog-surface`.
 */
@Component({
  template: `
    <div class="offset-container">
      <input-color-picker
        [value]="color()"
        (valueChange)="color.set($event)"
      />
    </div>
  `,
  styles: [
    `
      /* Fixed, not absolute: the trigger's viewport rect must not depend on
         how far the Karma page happens to be scrolled in a full-suite run. */
      .offset-container {
        position: fixed;
        top: 120px;
        left: 260px;
        backdrop-filter: blur(20px);
      }
    `,
  ],
  imports: [InputColorPickerComponent],
})
class TestHostComponent {
  readonly color = signal(START_COLOR);
}

describe('InputColorPickerComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let picker: InputColorPickerComponent;

  const trigger = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.color-trigger');
  const panel = (): HTMLElement | null => document.querySelector('.color-panel');
  const surface = (): HTMLElement => document.querySelector('.sv-surface') as HTMLElement;
  const hueBar = (): HTMLElement => document.querySelector('.hue-bar') as HTMLElement;
  const codeInput = (): HTMLInputElement =>
    document.querySelector('.color-code') as HTMLInputElement;

  const open = (): void => {
    trigger().click();
    fixture.detectChanges();
  };

  const pointerEvent = (type: string, x: number, y: number): PointerEvent =>
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    });

  /** Drags to a position given as a fraction of the element's own box. */
  const dragTo = (element: HTMLElement, xRatio: number, yRatio: number): void => {
    const rect = element.getBoundingClientRect();
    const offsetX = rect.width * xRatio;
    const offsetY = rect.height * yRatio;
    const x = rect.left + offsetX;
    const y = rect.top + offsetY;

    element.dispatchEvent(pointerEvent('pointerdown', x, y));
    element.dispatchEvent(pointerEvent('pointermove', x, y));
    element.dispatchEvent(pointerEvent('pointerup', x, y));
    fixture.detectChanges();
  };

  const typeCode = (value: string): void => {
    const input = codeInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, NoopAnimationsModule],
      providers: [
        {
          provide: TranslateService,
          useValue: {
            instant: (key: string) => key,
            get: (key: string) => of(key),
            onLangChange: EMPTY,
            onFallbackLangChange: EMPTY,
            onTranslationChange: EMPTY,
            onDefaultLangChange: EMPTY,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    picker = fixture.debugElement.query(By.directive(InputColorPickerComponent))
      .componentInstance as InputColorPickerComponent;
  });

  it('should not render the panel until opened', () => {
    expect(panel()).toBeNull();
  });

  it('should render the panel in the CDK overlay container, not inside the component', () => {
    open();

    const el = panel();
    expect(el).not.toBeNull();
    expect(el!.closest('.cdk-overlay-container')).not.toBeNull();
    expect(fixture.nativeElement.contains(el)).toBe(false);
  });

  // Regression test for #9423.
  it('should position the panel against the trigger when an ancestor establishes a containing block', () => {
    open();

    const triggerRect = trigger().getBoundingClientRect();
    const panelRect = panel()!.getBoundingClientRect();

    expect(panelRect.left).toBeCloseTo(triggerRect.left, 0);

    const isBelow = Math.abs(panelRect.top - triggerRect.bottom) <= 8;
    const isAbove = Math.abs(panelRect.bottom - triggerRect.top) <= 8;
    expect(isBelow || isAbove).toBe(true);

    expect(panelRect.top).toBeGreaterThanOrEqual(0);
    expect(panelRect.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(panelRect.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('should toggle closed when the trigger is clicked again', () => {
    open();
    expect(picker.isOpen()).toBe(true);

    open();

    expect(picker.isOpen()).toBe(false);
    expect(panel()).toBeNull();
  });

  it('should close on escape without needing focus inside the panel', () => {
    open();

    // CDK's overlay keyboard dispatcher listens on `body` and reads `keyCode`.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      } as KeyboardEventInit & { keyCode: number }),
    );
    fixture.detectChanges();

    expect(picker.isOpen()).toBe(false);
    expect(panel()).toBeNull();
  });

  it('should show the incoming value', () => {
    expect(picker.color()).toBe(START_COLOR);

    fixture.componentInstance.color.set('#00ff00');
    fixture.detectChanges();

    expect(picker.color()).toBe('#00ff00');
    expect(trigger().style.backgroundColor).toBe('rgb(0, 255, 0)');
  });

  it('should emit the color under the pointer when dragging the saturation/value surface', () => {
    open();

    dragTo(surface(), 1, 0);
    expect(fixture.componentInstance.color()).toBe(START_COLOR);

    dragTo(surface(), 0, 0);
    expect(fixture.componentInstance.color()).toBe('#ffffff');

    dragTo(surface(), 1, 1);
    expect(fixture.componentInstance.color()).toBe('#000000');
  });

  it('should emit the hue picked on the bar and keep the other channels', () => {
    open();

    dragTo(hueBar(), 1 / 3, 0.5);

    // Saturation/value are untouched: #ff0000 becomes pure green.
    expect(fixture.componentInstance.color()).toBe('#00ff00');
  });

  it('should keep the hue when the dragged color passes through grey', () => {
    open();

    // Pick a non-red hue first, so a dropped hue would show up as red.
    dragTo(hueBar(), 1 / 3, 0.5);

    dragTo(surface(), 0, 0);
    expect(fixture.componentInstance.color()).toBe('#ffffff');

    // A hex-only round trip would have lost the green hue here.
    dragTo(surface(), 1, 0);
    expect(fixture.componentInstance.color()).toBe('#00ff00');
  });

  it('should emit a typed color code', () => {
    open();

    typeCode('#00ff00');

    expect(fixture.componentInstance.color()).toBe('#00ff00');
    expect(picker.color()).toBe('#00ff00');
  });

  it('should keep a half-typed color code without emitting it', () => {
    open();

    typeCode('#00ff');

    expect(fixture.componentInstance.color()).toBe('#ff0000');
    expect(picker.codeValue()).toBe('#00ff');

    codeInput().dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(picker.codeValue()).toBe('#ff0000');
  });
});
