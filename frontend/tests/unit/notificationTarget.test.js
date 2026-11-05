import { describe, it, expect } from 'vitest';
import { notificationDestination } from '../../src/lib/notificationTarget';

const can = (...navs) => (nav) => navs.includes(nav);

describe('where a notification opens', () => {
  it('a test with no result opens that department, with the patient found', () => {
    const target = { kind: 'worklist', departments: ['Laboratory'], find: 'Rosario Salcedo' };
    expect(notificationDestination(target, can('lab-ops'))).toEqual({ nav: 'lab-ops', intent: { find: 'Rosario Salcedo' } });
  });

  it('one notice, two people: the cashier gets the till and the receptionist the Desk', () => {
    const target = { kind: 'till', find: 'Ana Cruz' };
    expect(notificationDestination(target, can('cashier-queue', 'reception-queue')).nav).toBe('cashier-queue');
    expect(notificationDestination(target, can('reception-queue')).nav).toBe('reception-queue');
  });

  it('a ticket on two departments opens the one this person works in', () => {
    const target = { kind: 'ticket', departments: ['Laboratory', 'Ultrasound'], find: 'Ana Cruz' };
    expect(notificationDestination(target, can('ultrasound-ops')).nav).toBe('ultrasound-ops');
    expect(notificationDestination(target, can('reception-queue')).nav).toBe('reception-queue');
  });

  it('a booking opens Appointments for an Admin, and its card at the Desk for the front desk', () => {
    const target = { kind: 'booking', reference: 'APT-1' };
    expect(notificationDestination(target, can('appointments-list', 'reception-queue')).nav).toBe('appointments-list');
    expect(notificationDestination(target, can('reception-queue'))).toEqual({ nav: 'reception-queue', intent: { verify: 'APT-1' } });
  });

  it('a claim opens that claim', () => {
    expect(notificationDestination({ kind: 'claim', claimId: 7 }, can('service-requests')).intent).toEqual({ claimId: 7 });
  });

  it('nothing to open: an older notice, an unknown kind, or a screen this person does not have', () => {
    expect(notificationDestination(null, can('lab-ops'))).toBeNull();
    expect(notificationDestination({ kind: 'new-thing' }, can('lab-ops'))).toBeNull();
    expect(notificationDestination({ kind: 'activity' }, can('lab-ops'))).toBeNull();
    expect(notificationDestination({ kind: 'worklist', departments: ['Xray'], find: 'A' }, can('lab-ops'))).toBeNull();
  });
});
