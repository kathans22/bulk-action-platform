const express = require('express');
const controller = require('../controllers/bulkActions.controller');

const router = express.Router();

router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.detail);
router.get('/:id/stats', controller.stats);
router.get('/:id/logs', controller.logs);

module.exports = router;
