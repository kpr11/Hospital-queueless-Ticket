const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireStaff } = require('../middleware/auth');
const controller = require('../controllers/consultation.controller');

router.get('/lab-tests',        requireStaff, asyncHandler(controller.labTests));
router.get('/',                 requireStaff, asyncHandler(controller.get));
router.put('/:id',              requireStaff, asyncHandler(controller.update));
router.post('/:id/lab-orders',  requireStaff, asyncHandler(controller.addLabOrders));
router.post('/:id/complete',    requireStaff, asyncHandler(controller.complete));

module.exports = router;
