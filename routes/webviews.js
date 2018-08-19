'use strict';

const config = require('../config');
const express = require('express');

const router = express.Router();


router.get('/webview', function (req, res) {
    res.render('newsletter-settings');
});



module.exports = router;
