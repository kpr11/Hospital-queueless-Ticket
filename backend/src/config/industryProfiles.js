/**
 * Server-side mirror of the frontend industry profiles
 * (frontend/src/utils/industry.js).
 *
 * Used to seed real `queues` records when an organisation picks an industry but
 * has not defined its own counters yet. Keep the `id` values in sync with the
 * frontend — a token's `service` field references them.
 */
const INDUSTRY_PROFILES = {
  general: {
    name: 'General Office',
    services: [
      { id: 'general', title: 'General Inquiry', prefix: 'G' },
      { id: 'consultation', title: 'Consultation', prefix: 'C' },
      { id: 'transaction', title: 'Transaction', prefix: 'T' },
      { id: 'billing', title: 'Billing & Payments', prefix: 'B' },
      { id: 'support', title: 'Help & Support', prefix: 'S' },
    ],
  },
  bank: {
    name: 'Bank / Finance',
    services: [
      { id: 'new_account', title: 'New Account', prefix: 'NA' },
      { id: 'loan', title: 'Loan Application', prefix: 'L' },
      { id: 'forex', title: 'Foreign Exchange', prefix: 'FX' },
      { id: 'card_services', title: 'Card Services', prefix: 'CS' },
      { id: 'priority_banking', title: 'Priority Banking', prefix: 'PB' },
      { id: 'locker', title: 'Locker Services', prefix: 'LK' },
      { id: 'general', title: 'General Banking', prefix: 'GB' },
    ],
  },
  medical: {
    name: 'Medical / Hospital',
    services: [
      { id: 'opd', title: 'OPD / Doctor', prefix: 'OP' },
      { id: 'eye_specialist', title: 'Eye Specialist', prefix: 'EY' },
      { id: 'cardiology', title: 'Cardiology', prefix: 'CA' },
      { id: 'dental', title: 'Dental', prefix: 'DN' },
      { id: 'ent', title: 'ENT', prefix: 'EN' },
      { id: 'dermatology', title: 'Dermatology', prefix: 'DR' },
      { id: 'orthopedics', title: 'Orthopedics', prefix: 'OR' },
      { id: 'pediatrics', title: 'Pediatrics', prefix: 'PD' },
      { id: 'gynecology', title: 'Gynecology', prefix: 'GY' },
      { id: 'lab', title: 'Lab Tests', prefix: 'LB' },
      { id: 'pharmacy', title: 'Pharmacy', prefix: 'PH' },
      { id: 'radiology', title: 'Radiology', prefix: 'RD' },
      { id: 'emergency', title: 'Emergency', prefix: 'ER' },
    ],
  },
  restaurant: {
    name: 'Restaurant / Dining',
    services: [
      { id: 'table_small', title: 'Table (1-2)', prefix: 'TS' },
      { id: 'table_medium', title: 'Table (3-4)', prefix: 'TM' },
      { id: 'table_large', title: 'Table (5+)', prefix: 'TL' },
      { id: 'reservation', title: 'Reservation', prefix: 'RS' },
      { id: 'takeaway', title: 'Takeaway', prefix: 'TA' },
      { id: 'bar', title: 'Bar / Lounge', prefix: 'BR' },
    ],
  },
};

module.exports = { INDUSTRY_PROFILES };
