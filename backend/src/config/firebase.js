const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const config = require('./env');

if (!admin.getApps().length) {
  admin.initializeApp({
    credential: admin.cert({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
    }),
    databaseURL: config.firebase.databaseURL,
  });
}

const db = getDatabase();

const refs = {
  queueState: () => db.ref('queue/state'),
  tokens: () => db.ref('queue/tokens'),
  token: (id) => db.ref(`queue/tokens/${id}`),
  counter: () => db.ref('queue/counter'),
  admins: () => db.ref('admins'),
  admin: (username) => db.ref(`admins/${username}`),
  staff: () => db.ref('staff'),
  staffMember: (username) => db.ref(`staff/${username}`),
  presence: () => db.ref('presence'),
  presenceMember: (username) => db.ref(`presence/${username}`),
  appConfig: () => db.ref('config'),
  queues: () => db.ref('queues'),
  queueDef: (id) => db.ref(`queues/${id}`),
  // Messaging — content lives here but is served only via the JWT API (never
  // client-readable). `messageSignals` is a content-free real-time trigger.
  conversations: () => db.ref('conversations'),
  conversationMeta: (id) => db.ref(`conversations/${id}/meta`),
  conversationMessages: (id) => db.ref(`conversations/${id}/messages`),
  conversationMessage: (id, mid) => db.ref(`conversations/${id}/messages/${mid}`),
  conversationReads: (id) => db.ref(`conversations/${id}/reads`),
  conversationRead: (id, username) => db.ref(`conversations/${id}/reads/${username}`),
  messageSignal: (id) => db.ref(`messageSignals/${id}`),
  // Notifications — content via JWT API only; `notificationSignals` is the
  // content-free real-time trigger (client-readable).
  notifications: (username) => db.ref(`notifications/${username}`),
  notification: (username, id) => db.ref(`notifications/${username}/${id}`),
  notificationSignal: (username) => db.ref(`notificationSignals/${username}`),
  // Secure shares (capability links) + audit log.
  shares: () => db.ref('shares'),
  share: (id) => db.ref(`shares/${id}`),
  auditLogs: () => db.ref('auditLogs'),
  auditLog: (id) => db.ref(`auditLogs/${id}`),
  // Shared files — stored in RTDB (free on the Spark plan; no Cloud Storage /
  // Blaze required). Metadata is indexed separately so listing never pulls blobs.
  uploads: () => db.ref('uploads'),
  upload: (id) => db.ref(`uploads/${id}`),
  uploadIndex: (owner) => db.ref(`uploadIndex/${owner}`),
  uploadIndexEntry: (owner, id) => db.ref(`uploadIndex/${owner}/${id}`),
  feedback: () => db.ref('feedback'),
  feedbackEntry: (tokenId) => db.ref(`feedback/${tokenId}`),
  announcement: () => db.ref('queue/announcement'),
  appointments: () => db.ref('appointments'),
  appointment: (id) => db.ref(`appointments/${id}`),
  // Hospital patient registry — PII (name, mobile, address, …). Backend-only
  // via the Admin SDK; never client-readable. Served only through the JWT API.
  patients: () => db.ref('hospital/patients'),
  patient: (id) => db.ref(`hospital/patients/${id}`),
  // Daily doctor roster for a department: which doctors are on duty today, their
  // room numbers, and their live availability. Keyed by ISO date then department.
  roster: (date, dept) => db.ref(`hospital/roster/${date}/${dept}`),
  rosterDoctor: (date, dept, username) => db.ref(`hospital/roster/${date}/${dept}/doctors/${username}`),
  rosterCursor: (date, dept) => db.ref(`hospital/roster/${date}/${dept}/cursor`),
  // Consultation records — a permanent per-patient clinical note history.
  consultations: () => db.ref('hospital/consultations'),
  consultation: (id) => db.ref(`hospital/consultations/${id}`),
};

module.exports = { admin, db, refs };
