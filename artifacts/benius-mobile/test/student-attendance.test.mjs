import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calendarWeekday, formatDateOnly, getDayCell, getMonthlySummary, getYearlyMonthPercentage, istToday } from '../lib/student-attendance-pure.mjs';
const day = (status = 'none', extra = {}) => ({ date: '2026-09-06', status, isSunday: false, isHoliday: false, holidayName: null, isApprovedLeave: false, isFuture: false, isInSession: true, ...extra });
describe('attendance display parity', () => {
  it('excludes outside and future even if marked', () => {
    for (const flag of ['isInSession', 'isFuture']) {
      const value = day('absent', { [flag]: flag === 'isFuture' });
      assert.equal(getMonthlySummary([value]).absent, 0);
      assert.equal(getDayCell(value).tone, flag === 'isFuture' ? 'future' : 'outside');
    }
  });
  it('distinguishes unmarked Sunday, holiday and approved leave', () => {
    const sunday = day('none', { isSunday: true });
    const holiday = day('none', { isHoliday: true, holidayName: 'School holiday' });
    const leave = day('none', { isApprovedLeave: true });
    assert.equal(getDayCell(sunday).label, 'Sunday');
    assert.equal(getDayCell(holiday).label, 'School holiday');
    assert.equal(getDayCell(leave).label, 'Approved Leave');
    assert.deepEqual(getMonthlySummary([sunday, holiday, leave]), { present: 0, absent: 0, halfDay: 0, late: 0, leave: 1, holiday: 1 });
  });
  it('counts stored statuses even on Sundays and holidays', () => {
    for (const [status, field] of [['present','present'], ['absent','absent'], ['late','late'], ['halfday','halfDay'], ['half_day','halfDay'], ['leave','leave']]) {
      assert.equal(getMonthlySummary([day(status, { isSunday: true, isHoliday: true })])[field], 1);
    }
  });
  it('renders unknown without inventing a count', () => {
    assert.equal(getDayCell(day('excused')).label, 'excused');
    assert.deepEqual(getMonthlySummary([day('excused')]), { present: 0, absent: 0, halfDay: 0, late: 0, leave: 0, holiday: 0 });
  });
  it('uses weighted yearly denominator', () => {
    assert.equal(getYearlyMonthPercentage({ present: 1, late: 1, leave: 1, halfDay: 1, workingDays: 6 }), 58.3);
    assert.equal(getYearlyMonthPercentage({ present: 1, late: 0, leave: 0, halfDay: 0, workingDays: 0 }), 0);
  });
  it('keeps calendar dates independent of device timezone and finds IST today', () => {
    assert.deepEqual(istToday(new Date('2026-09-30T19:00:00Z')), { year: 2026, month: 10, day: 1 });
    assert.equal(calendarWeekday('2026-09-06'), 0);
    assert.equal(formatDateOnly('2026-09-06'), '6 September 2026');
    assert.equal(calendarWeekday('2026-02-30'), null);
  });
});