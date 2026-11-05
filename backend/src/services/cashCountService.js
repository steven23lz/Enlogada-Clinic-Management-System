const db = require('../config/database');
const cashCountRepository = require('../repositories/cashCountRepository');
const clinicSettingRepository = require('../repositories/clinicSettingRepository');
const paymentRepository = require('../repositories/paymentRepository');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { CASH_METHOD } = require('../constants/paymentMethods');
const { localDateStr } = require('../utils/csvExport');
const {
  readCount, readChangeFund, expectedInDrawer, differenceOf, outcomeOf,
} = require('../utils/cashCount');
const { formatCurrency } = require('../utils/money');

/** How far back a day can still be counted: a forgotten Friday is counted on Saturday, not next month. */
const COUNT_BACK_DAYS = 7;
const DEFAULT_LIST_DAYS = 30;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

const fail = (status, message) => {
  const error = new Error(message);
  error.statusCode = status;
  return error;
};

const daysBefore = (date, days) => {
  const [y, m, d] = date.split('-').map(Number);
  return localDateStr(new Date(y, m - 1, d - days));
};

const money = (value) => Number(value || 0);

/** A row as the screens read it: money as numbers, and the words a person would use. */
const shapeCount = (row) => row && ({
  id: row.id,
  date: localDateStr(new Date(row.business_date)),
  changeFund: money(row.change_fund),
  expectedCash: money(row.expected_cash),
  expectedGcash: money(row.expected_gcash),
  expectedBank: money(row.expected_bank),
  receipts: row.receipts,
  expectedInDrawer: expectedInDrawer({ changeFund: row.change_fund, cash: row.expected_cash }),
  counted: money(row.counted_cash),
  difference: money(row.difference),
  outcome: outcomeOf(row.difference),
  pieces: row.pieces || {},
  note: row.note,
  countedBy: row.counted_by_name || 'Former staff',
  countedAt: row.counted_at,
  isCurrent: row.is_current,
});

/**
 * The end-of-day cash count. [1.150.0]
 *
 * The app knew exactly what the till took and nothing about what was in the drawer, so a shortage
 * surfaced, if at all, when someone counted by hand and had nowhere to write it down. Now the
 * cashier counts by note and coin, the server works out the total and the difference, and the
 * Admin sees every day on Cashier Monitoring, with a bell when one does not balance.
 *
 * - One drawer, one count a day. Whoever closes counts the clinic's whole drawer, whichever cashier
 *   took each receipt. [1.162.0] Or, once Super Admin says so, one drawer per cashier: each counts only
 *   the cash they took (`drawer_of`), and the list has a row per day and cashier.
 * - What was expected is SNAPSHOT on the count. A payment taken afterwards cannot change what it was
 *   measured against, the closed-day rule [1.30.0] applied to the drawer; it shows as "taken after
 *   this count" on the list instead.
 * - A recount adds a version and supersedes the last (`is_current`), and needs a reason. A cashier
 *   can correct a miscount; a shortage counted away still shows that it was found.
 * - GCash and bank are shown, not counted: that money never entered the drawer.
 * - Expected cash reads `findTransactionSummary`, the one cash book: cash taken, less any cash handed
 *   back that day.
 */
class CashCountService {
  async drawerMode() {
    return (await clinicSettingRepository.get('cash_drawers')) === 'per_cashier' ? 'per_cashier' : 'shared';
  }

  /** Whose drawer this person counts: NULL is the clinic's one shared drawer. */
  async drawerOfUser(user) {
    return (await this.drawerMode()) === 'per_cashier' ? user?.userId ?? null : null;
  }

  async setDrawerMode(mode, user) {
    if (!['shared', 'per_cashier'].includes(mode)) throw fail(400, 'Choose one shared drawer, or one per cashier.');
    await clinicSettingRepository.set('cash_drawers', mode, user.userId);
    auditService.log({
      actorId: user.userId,
      action: 'clinic.cash_drawers_changed',
      entityType: 'clinic_setting',
      entityId: null,
      description: mode === 'per_cashier' ? 'Set the Cash Count to one drawer per cashier' : 'Set the Cash Count to one shared drawer',
    });
    return { mode };
  }

  assertCountable(date) {
    if (!DATE_FORMAT.test(String(date || ''))) throw fail(400, 'Say which day, as YYYY-MM-DD.');
    const today = localDateStr();
    if (date > today) throw fail(400, 'A day cannot be counted before it has happened.');
    if (date < daysBefore(today, COUNT_BACK_DAYS)) {
      throw fail(409, `A drawer can be counted up to ${COUNT_BACK_DAYS} days later. This day was not counted, and stays on record that way.`);
    }
  }

  /** What the till says for one day. */
  async expectedFor(date, drawerOf = null) {
    if (drawerOf) {
      const mine = await cashCountRepository.findCashierDay(date, drawerOf);
      return { cash: money(mine.cash), gcash: money(mine.gcash), bank: money(mine.bank), receipts: mine.receipts };
    }
    const [all, cash] = await Promise.all([
      paymentRepository.findTransactionSummary({ startDate: date, endDate: date }),
      paymentRepository.findTransactionSummary({ startDate: date, endDate: date, method: CASH_METHOD }),
    ]);
    return {
      cash: Math.round((money(all.cash) - money(cash.reversed)) * 100) / 100,
      gcash: money(all.ewallet),
      bank: money(all.bank),
      receipts: all.receipts,
    };
  }

  /** The Cash Count screen: what the till says for the day, and any count of it so far. */
  async day(date = localDateStr(), user = null) {
    if (!DATE_FORMAT.test(String(date))) throw fail(400, 'Say which day, as YYYY-MM-DD.');
    const drawerOf = await this.drawerOfUser(user);
    const [expected, versions, lastFund] = await Promise.all([
      this.expectedFor(date, drawerOf),
      cashCountRepository.findVersions(date, drawerOf),
      cashCountRepository.findLastChangeFund(drawerOf),
    ]);
    const counts = versions.map(shapeCount);
    const current = counts.find((c) => c.isCurrent) || null;
    return {
      date,
      ownDrawer: Boolean(drawerOf),
      isToday: date === localDateStr(),
      countable: date <= localDateStr() && date >= daysBefore(localDateStr(), COUNT_BACK_DAYS),
      expected,
      current,
      replaced: counts.filter((c) => !c.isCurrent),
      takenAfter: current ? Math.round((expected.cash - current.expectedCash) * 100) / 100 : 0,
      suggestedChangeFund: lastFund === null ? null : money(lastFund),
    };
  }

  async save({ date = localDateStr(), changeFund, pieces, loose, note }, user) {
    this.assertCountable(date);
    const fund = readChangeFund(changeFund);
    if (fund === null) throw fail(400, 'Enter the change fund the drawer started with. If there was none, enter 0.');
    const count = readCount({ pieces, loose });
    if (count.error) throw fail(400, count.error);
    const said = String(note ?? '').trim();
    if (said.length > 500) throw fail(400, 'Keep the note under 500 characters.');

    const drawerOf = await this.drawerOfUser(user);
    const saved = await db.withTransaction(async () => {
      // Two people closing at once take turns; the partial unique index has the last word.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cash-count|${date}|${drawerOf || ''}`]);
      const versions = await cashCountRepository.findVersions(date, drawerOf);
      const current = versions.find((v) => v.is_current);
      const expected = await this.expectedFor(date, drawerOf);
      const difference = differenceOf({ counted: count.total, changeFund: fund, cash: expected.cash });

      if (current && !said) throw fail(400, 'This day was already counted. Say why it is being counted again.');
      if (outcomeOf(difference) !== 'balanced' && !said) {
        throw fail(400, 'The drawer does not balance. Say what you know about the difference.');
      }
      if (current) await cashCountRepository.supersede(current.id);
      const id = await cashCountRepository.create({
        date,
        changeFund: fund,
        expected,
        counted: count.total,
        pieces: { ...count.pieces, ...(count.loose ? { loose: count.loose } : {}) },
        note: said || null,
        countedBy: user.userId,
        drawerOf,
      });
      return { id, difference, recount: Boolean(current) };
    });

    // After the commit: the count stands whether or not anything below works.
    const outcome = outcomeOf(saved.difference);
    const words = outcome === 'balanced' ? 'it balances' : `${formatCurrency(Math.abs(saved.difference))} ${outcome}`;
    auditService.log({
      actorId: user.userId,
      action: saved.recount ? 'cash.day_recounted' : 'cash.day_counted',
      entityType: 'cash_count',
      entityId: saved.id,
      description: `${saved.recount ? 'Counted the drawer again' : 'Counted the drawer'} for ${date}: ${formatCurrency(count.total)}, ${words}.${said ? ` ${said}` : ''}`,
    });
    if (outcome !== 'balanced') {
      notificationService.notifyRoles(['Admin', 'SuperAdmin'], {
        title: `Drawer ${outcome} by ${formatCurrency(Math.abs(saved.difference))}`,
        message: `The count for ${date}. See Cashier Monitoring.`,
        type: 'warning',
      }).catch(() => { /* the count is on record whether or not the bell rings */ });
    }
    return this.day(date, user);
  }

  /** Each day, counted or not, for Cashier Monitoring and the Cash Count screen. */
  async days({ startDate, endDate, page, limit } = {}) {
    const today = localDateStr();
    const end = endDate || today;
    const start = startDate || daysBefore(today, DEFAULT_LIST_DAYS);
    if (!DATE_FORMAT.test(start) || !DATE_FORMAT.test(end)) throw fail(400, 'Dates are YYYY-MM-DD.');
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);

    const perCashier = (await this.drawerMode()) === 'per_cashier';
    const [rows, summary] = await Promise.all([
      cashCountRepository.findDays({ startDate: start, endDate: end, limit: limitNum, offset: (pageNum - 1) * limitNum, perCashier }),
      cashCountRepository.findDaysSummary({ startDate: start, endDate: end, perCashier }),
    ]);
    return {
      startDate: start,
      endDate: end,
      summary: {
        days: summary.days,
        counted: summary.counted,
        notCounted: summary.not_counted,
        short: money(summary.short),
        over: money(summary.over),
      },
      days: rows.map((r) => ({
        date: r.day,
        drawerName: r.drawer ? (r.drawer_name || 'Former staff') : null,
        drawerKey: r.drawer || 'shared',
        isToday: r.day === today,
        receipts: r.receipts_now,
        cash: money(r.cash_now),
        gcash: money(r.gcash_now),
        bank: money(r.bank_now),
        takenAfter: r.id ? money(r.taken_after) : 0,
        beforeCounting: !r.id && r.before_counting,
        recounts: r.id ? r.recounts : 0,
        count: r.id ? shapeCount(r) : null,
      })),
      total: summary.days,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(summary.days / limitNum)),
    };
  }

  /** What Today needs to remind whoever closes: days left uncounted, and whether today has been. */
  async status(user = null) {
    const today = localDateStr();
    const drawerOf = await this.drawerOfUser(user);
    const [uncounted, counted, expected] = await Promise.all([
      cashCountRepository.findUncountedDays(COUNT_BACK_DAYS, drawerOf),
      cashCountRepository.hasCurrent(today, drawerOf),
      this.expectedFor(today, drawerOf),
    ]);
    return { today, todayCounted: counted, todayCash: expected.cash, uncounted };
  }
}

module.exports = new CashCountService();
