'use strict';

const config = require('../config');
const express = require('express');
const fbservice = require('../services/fb-service');

const router = express.Router();

const pg = require('pg');
pg.defaults.ssl = true;

router.get('/webview', function (req, res) {
    res.render('newsletter-settings');
});

router.get('/save', function (req, res) {
    let body = req.query;
    let topics = body.topics.join(',');
    let pool = new pg.Pool(config.PG_CONFIG);
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('Error acquiering client');
        }
        client.query("UPDATE public.users SET newsletter=$1, topics=$2, deals=$3 WHERE fb_id=$4",
            [
                body.newsletter,
                topics,
                body.deals,
                body.psid
            ],
            function (err, result) {
                if(err === null) {
                    fbservice.sendTextMessage(body.psid, 'Settings saved.');
                } else {
                    console.log('ERR: ' + err);
                }
            });
    });
});


router.get('/settings', function (req, res) {

    let pool = new pg.Pool(config.PG_CONFIG);
    pool.connect(function (err, client, done) {
        if (err) {
            return console.error('Error acquiering client');
        }
        client.query("SELECT newsletter, topics, deals FROM public.users WHERE fb_id=$1",
            [
                req.query.psid
            ],
            function (err, result) {
                if(err === null) {
                    let settings = [];
                    if (result.rows.length > 0) {
                        settings = result.rows[0];
                    }
                    res.json(settings);
                } else {
                    res.json([]);
                }
            }
        )
    })

});

module.exports = router;
