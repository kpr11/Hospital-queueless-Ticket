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
};

module.exports = { INDUSTRY_PROFILES };
