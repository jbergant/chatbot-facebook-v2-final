const config = require('../config');
const express = require('express');
const userService = require('../services/user-service');
const fbService = require('../services/fb-service');
const router = express.Router();


router.get('/', function (req, res) {
    //res.send('Hello world, I am a chat bot')
    res.render('login');
});


router.get('/no-access', function (req, res) {
    res.render('no-access');
});

router.get('/broadcast', ensureAuthenticated, function (req, res) {
    res.render('broadcast');
});

router.post('/broadcast', ensureAuthenticated, function (req, res) {
    res.render('broadcast-confirm');
});

router.get('/broadcast-send', ensureAuthenticated, function (req, res) {
    res.redirect('/broadcast/broadcast-sent');
});

router.get('/broadcast-sent', ensureAuthenticated, function (req, res) {
    res.render('broadcast-sent');
});

router.get('/logout', ensureAuthenticated, function (req, res) {
    req.logout();
    res.redirect('/broadcast/');
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.redirect('/broadcast/');
    }
}


module.exports = router;
