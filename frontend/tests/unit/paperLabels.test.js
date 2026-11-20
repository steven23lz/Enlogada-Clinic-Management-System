import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every button, tab and screen name the submitted paper's User's Guide (Appendix E) tells a reader
// to click or open. [1.168.0] The paper is final, so a wording improvement may change any sentence
// on a screen but never one of these: a panel member following the guide must find each one.
// Rename one of these only if the paper changes with it.
const PAPER_LABELS = [
  // E.3 Getting started, the portal and the staff screen
  'Create Account', 'Sign In', 'Forgot password?', 'Send code', 'Today', 'Log out', 'My Account', 'Sign out',
  'Home', 'Visits', 'Results', 'Payments', 'Profile', 'Viewing',
  // E.4 Patients
  'Add a profile', 'Save profile', 'Book a visit', "Next: HMO & Doctor's Notes", 'Submit Schedule Request',
  // The guide writes "Reference Number"; the field label is "Reference number", shown in capitals.
  'These are the tests I want', 'Reference number', 'Send for verification', 'Reschedule', 'Confirm new time',
  'Release booking', 'View report', 'View Report', 'How was your visit?', 'A record is waiting',
  // E.5 Receptionist
  'Desk', 'Still to arrive today', 'Check in', "Who's here?", 'Scan pass', 'Confirm Check-In Patient', 'Start visit',
  'Register Walk-In', 'Register Walk-In & Issue Queue Ticket', 'Walk-In Registration', 'Edit Tests', 'Log HMO Request',
  'Patient Records', 'Correct', 'Portal access', 'Send invitation', 'Visit History',
  // E.6 Cashier
  'Billing Queue', 'Apply', 'Take Payment', 'Print Receipt', 'Online Payments', 'Review', 'Verify & issue receipt',
  'Record payment', 'Reject', 'Transaction History', 'Find a receipt', 'Reprint', 'Cash Count', 'Save count', 'Print',
  // E.7 Departments
  'Laboratory Worklist', 'Laboratory History', 'Ultrasound Worklist', 'Ultrasound History', 'X-Ray Worklist',
  'X-Ray History', 'Attach Report', 'Save for Later', 'Authorize & Release Result', 'Authorize & Release',
  'Email to patient', 'Done', 'Email', 'Edit', 'Withdraw',
  // E.8 Admin
  'Service Requests', 'Approve', 'The provider turned this claim down', 'Services Catalog', 'Add New Service',
  'Add Provider', 'Staff Accounts', 'Add Staff Account', 'Clinic Schedule', 'Save', 'Save date', 'Reports',
  'Departments', 'Trends', 'HMO Claims', 'Staff Workload', 'Export Excel', 'Cashier Monitoring', 'Appointments',
  'Patient Feedback', 'Questions', 'Activity Log',
  // E.9 Super Admin
  'Super Admin', 'Who sees what', 'One person', 'Elevated Accounts', 'Add Elevated Account', 'Payment Methods',
  'Add Method', 'Cash drawers', 'Refund',
  // E.10 Troubleshooting
  'Refresh', 'Try again',
];

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');

function sourceText(dir) {
  let text = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) text += sourceText(path);
    else if (/\.(jsx?|tsx?)$/.test(name)) text += readFileSync(path, 'utf8') + '\n';
  }
  return text;
}

// JSX writes some of these with entities (`&amp;`, `&apos;`) or a curly apostrophe.
const normalise = (s) => s
  .replace(/&amp;/g, '&').replace(/&apos;|&#39;|’/g, "'").replace(/&rarr;/g, '→').replace(/&quot;/g, '"');

describe("the paper's User's Guide still matches the screens", () => {
  const text = normalise(sourceText(SRC));
  it.each(PAPER_LABELS)('"%s" is still in the app', (label) => {
    expect(text.includes(label)).toBe(true);
  });
});
