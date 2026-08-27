const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { requireStaff } = require('../middleware/auth');
const controller = require('../controllers/patient.controller');

// Public self-registration is a write endpoint reachable without auth — keep it
// well under the abuse threshold.
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many registration attempts. Please slow down.' },
});

const demographicsSchema = {
  name: Joi.string().trim().min(2).max(100).required(),
  age: Joi.number().integer().min(0).max(120).required(),
  gender: Joi.string().valid('male', 'female', 'other').required(),
  mobile: Joi.string().trim().pattern(/^[6-9]\d{9}$/).required()
    .messages({ 'string.pattern.base': 'mobile must be a valid 10-digit Indian number.' }),
  address: Joi.string().trim().min(1).max(300).required(),
  department: Joi.string().trim().min(1).max(50).required(),
};

const registerSchema = Joi.object({
  ...demographicsSchema,
  aadhaar: Joi.string().trim().min(12).max(19).required(),
  consent: Joi.boolean().truthy('true').valid(true).required()
    .messages({ 'any.only': 'Consent to store your details is required to register.' }),
  priorityRequested: Joi.boolean().truthy('true').falsy('false').default(false),
  priorityReason: Joi.string().trim().max(200).allow('', null).optional(),
  // Honeypot — must be absent/empty. Bots that fill every field trip this.
  website: Joi.string().allow('', null).max(0).optional(),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  age: Joi.number().integer().min(0).max(120),
  gender: Joi.string().valid('male', 'female', 'other'),
  mobile: Joi.string().trim().pattern(/^[6-9]\d{9}$/),
  address: Joi.string().trim().min(1).max(300),
  department: Joi.string().trim().min(1).max(50),
  priorityRequested: Joi.boolean().truthy('true').falsy('false'),
  priorityReason: Joi.string().trim().max(200).allow('', null),
}).min(1);

const verifyIssueSchema = Joi.object({
  patientId: Joi.string().uuid().optional().allow('', null),
  aadhaar: Joi.string().trim().min(12).max(19).required(),
  department: Joi.string().trim().min(1).max(50).optional().allow('', null),
});

const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });

router.post('/register',           registerLimiter, validate(registerSchema),     asyncHandler(controller.register));
router.post('/reception/register', requireStaff,    validate(registerSchema),     asyncHandler(controller.receptionRegister));
router.get('/pending',             requireStaff,                                  asyncHandler(controller.listPending));
router.get('/registrations',       requireStaff,                                  asyncHandler(controller.listRegistrations));
router.get('/summary',             requireStaff,                                  asyncHandler(controller.summary));
router.get('/:id/status',          validate(idParamSchema, 'params'),             asyncHandler(controller.status));
router.post('/verify-issue',       requireStaff,    validate(verifyIssueSchema),  asyncHandler(controller.verifyAndIssue));
router.get('/:id',                 requireStaff,    validate(idParamSchema, 'params'), asyncHandler(controller.getOne));
router.put('/:id',                 requireStaff,    validate(idParamSchema, 'params'), validate(updateSchema), asyncHandler(controller.update));
router.post('/:id/cancel',         requireStaff,    validate(idParamSchema, 'params'), asyncHandler(controller.cancel));

module.exports = router;
