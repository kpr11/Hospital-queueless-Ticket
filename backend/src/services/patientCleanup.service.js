/**
 * Background sweeper for stale patient registrations.
 *
 * A patient who registers (self-service or reception) but never checks in at
 * the department desk would otherwise sit in the "waiting to check in" list
 * forever. This marks any `registered` record older than
 * `config.patient.registrationTtlHours` as `expired`. Mirrors expiry.service.js.
 */
const patientService = require('./patient.service');
const config = require('../config/env');

const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
let timer = null;

async function sweep() {
  try {
    const { expired } = await patientService.expireStaleRegistrations(config.patient.registrationTtlHours);
    if (expired > 0) {
      console.log(`[patientCleanup] Expired ${expired} stale registration(s).`);
    }
  } catch (err) {
    console.error('[patientCleanup] Sweep failed (non-fatal):', err.message);
  }
}

function startPatientCleanup() {
  if (timer) return;
  sweep();
  timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  console.log(`[patientCleanup] Registration cleanup started (TTL ${config.patient.registrationTtlHours}h, every 10 min).`);
}

function stopPatientCleanup() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startPatientCleanup, stopPatientCleanup };
