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
    res.render('broadcast', {user: req.user });
});

router.post('/broadcast', ensureAuthenticated, function (req, res) {
    let message = req.body.message;
    let newstype = parseInt(req.body.newstype, 10);
    req.session.newstype = newstype;
    req.session.message = message;
    userService.readAllUsers(function(users) {
        req.session.users = users;
        res.render('broadcast-confirm', {user: req.user, message: message, users: users, numUsers: users.length, newstype: newstype})
    }, newstype);
});

router.get('/broadcast-send', ensureAuthenticated, function (req, res) {
    let message = req.session.message;
    let allUsers = req.session.users;

    let sender;
    for (let i=0; i < allUsers.length; i++ ) {
        sender = allUsers[i].fb_id;
        fbService.sendTextMessage(sender, message);
    }

    res.redirect('/broadcast/broadcast-sent');
});

router.get('/broadcast-sent', ensureAuthenticated, function (req, res) {
    let newstype = req.session.newstype;
    let message = req.session.message;
    let users = req.session.users;

    req.session.newstype = null;
    req.session.message = null;
    req.session.users = null;
    res.render('broadcast-sent', {message: message, users: users, numUsers:users.length, newstype: newstype});
});

router.get('/logout', ensureAuthenticated, function (req, res) {
    req.logout();
    res.redirect('/broadcast/');
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        if (req.user.id === config.ADMIN_ID ) {
            return next();
        }
        res.redirect('/broadcast/no-access');
    } else {
        res.redirect('/broadcast/');
    }
}


module.exports = router;
