import { provideTranslateService } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { SingleViewComponent } from './single-view.component';
import { visibleItems } from './counting';
import { Dhikr } from '../../core/models';

describe('SingleViewComponent navigation', () => {
  it('navigates only visible items and makes completed items reachable when revealed', () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(SingleViewComponent);
    const items = [{ id: 'a', repeatCount: 1 }, { id: 'b', repeatCount: 1 }, { id: 'c', repeatCount: 1 }] as Dhikr[];
    const counts = new Map([['b', 1]]);
    const filtered = visibleItems(items, counts, 'hide', false);
    fixture.componentRef.setInput('items', filtered);
    fixture.componentRef.setInput('index', 0);
    const moved = vi.fn(); fixture.componentInstance.moved.subscribe(moved);
    fixture.componentInstance.move(1);
    expect(filtered[moved.mock.lastCall![0]].id).toBe('c');
    fixture.componentRef.setInput('index', 1);
    fixture.componentInstance.move(-1);
    expect(filtered[moved.mock.lastCall![0]].id).toBe('a');
    const revealed = visibleItems(items, counts, 'hide', true);
    fixture.componentRef.setInput('items', revealed);
    fixture.componentRef.setInput('index', 0);
    fixture.componentInstance.move(1);
    expect(revealed[moved.mock.lastCall![0]].id).toBe('b');
  });
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
