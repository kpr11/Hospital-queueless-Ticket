// Explicit allowlist: adding a private field to a token cannot expose it here.
const PUBLIC_FIELDS = [
  'id', 'number', 'service', 'priority', 'status', 'issuedAt', 'calledAt',
  'servedAt', 'expiresAt', 'expiredAt', 'skippedAt', 'groupSize', 'referred',
  'referredAt', 'room', 'positionInQueue', 'peopleAhead',
  'estimatedWaitSeconds', 'queueStatus',
];

function publicToken(token) {
  if (!token) return null;
  return Object.fromEntries(PUBLIC_FIELDS.filter(key => token[key] !== undefined)
    .map(key => [key, token[key]]));
}

module.exports = { publicToken };
