const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireStaff, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/roster.controller');

router.get('/public',                 asyncHandler(controller.getPublic));
router.get('/',                       requireStaff, asyncHandler(controller.get));
router.post('/doctors',               requireAdmin, asyncHandler(controller.addDoctor));
router.delete('/doctors/:username',   requireAdmin, asyncHandler(controller.removeDoctor));
router.post('/availability',          requireStaff, asyncHandler(controller.setAvailability));
router.post('/reassign',              requireAdmin, asyncHandler(controller.reassign));

module.exports = router;
