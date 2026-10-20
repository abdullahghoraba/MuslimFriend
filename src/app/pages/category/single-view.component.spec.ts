import { provideTranslateService } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { SingleViewComponent } from './single-view.component';
import { Dhikr } from '../../core/models';

describe('SingleViewComponent navigation', () => {
  it('moves left to the next dhikr in RTL, right to the previous, and ignores vertical swipes', () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(SingleViewComponent);
    fixture.componentRef.setInput('items', [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Dhikr[]);
    fixture.componentRef.setInput('index', 1);
    fixture.componentRef.setInput('rtl', true);
    const view = fixture.componentInstance;
    const moved = vi.fn(); view.moved.subscribe(moved);
    const start = (x: number, y: number) => view.touchStart({ touches: [{ clientX: x, clientY: y }] } as unknown as TouchEvent);
    const end = (x: number, y: number) => view.touchEnd({ changedTouches: [{ clientX: x, clientY: y }] } as unknown as TouchEvent);
    start(200, 100); end(100, 110); expect(moved).toHaveBeenLastCalledWith(2);
    start(100, 100); end(200, 110); expect(moved).toHaveBeenLastCalledWith(0);
    moved.mockClear(); start(200, 100); end(180, 300); expect(moved).not.toHaveBeenCalled();
    fixture.componentRef.setInput('index', 0); view.move(-1); expect(moved).not.toHaveBeenCalled();
    fixture.componentRef.setInput('index', 2); view.move(1); expect(moved).not.toHaveBeenCalled();
    start(200, 100); view.cancelTouch(); end(100, 100); expect(moved).not.toHaveBeenCalled();
  });
});
