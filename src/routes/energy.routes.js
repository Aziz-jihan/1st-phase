const express = require('express');
const { postOptimizeEnergy } = require('../controllers/energy.controller');

const router = express.Router();

router.post('/optimize-energy', postOptimizeEnergy);

module.exports = router;
