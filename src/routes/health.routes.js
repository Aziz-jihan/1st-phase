const express = require('express');
const { getHealth } = require('../controllers/energy.controller');

const router = express.Router();

router.get('/health', getHealth);

module.exports = router;
