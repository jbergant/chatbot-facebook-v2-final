'use strict';

const config = require('../config');
const express = require('express');
const fbservice = require('../services/fb-service');

const router = express.Router();


router.get('/webview', function (req, res) {
    res.render('newsletter-settings');
});

router.get('/save', function (req, res) {
    let body = req.query;
    let topics = body.topics.join(',');
    let response = `Newsletter ${body.newsletter}, topics: ${topics} and deals ${body.deals} 
    for psid ${body.psid}`;

    // psid??
    fbservice.sendTextMessage(body.psid, response);
});

module.exports = router;
