'use strict';

const dialogflow = require('dialogflow');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const pg = require('pg');
pg.defaults.ssl = true;

const broadcast = require('./routes/broadcast');
const webviews = require('./routes/webviews');

const userService = require('./services/user-service');
const colors = require('./colors');
const weatherService = require('./services/weather-service');
const jobApplicationService = require('./services/job-application-service');
let dialogflowService = require('./services/dialogflow-service');
const fbService = require('./services/fb-service');

const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
const session = require('express-session');

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
	throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
	throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
	throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
	throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}
if (!config.SENGRID_API_KEY) { //sending email
    throw new Error('missing SENGRID_API_KEY');
}
if (!config.EMAIL_FROM) { //sending email
    throw new Error('missing EMAIL_FROM');
}
if (!config.EMAIL_TO) { //sending email
    throw new Error('missing EMAIL_TO');
}
if (!config.WEATHER_API_KEY) { //weather api key
    throw new Error('missing WEATHER_API_KEY');
}
if (!config.PG_CONFIG) { //pg config
    throw new Error('missing PG_CONFIG');
}
if (!config.FB_APP_ID) { //app id
    throw new Error('missing FB_APP_ID');
}
if (!config.ADMIN_ID) { //admin id for login
    throw new Error('missing ADMIN_ID');
}
if (!config.FB_PAGE_INBOX_ID) { //page inbox id - the receiver app
    throw new Error('missing FB_PAGE_INBOX_ID');
}

app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: fbService.verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}));

// Process application/json
app.use(bodyParser.json());


app.use(session(
    {
        secret: 'keyboard cat',
        resave: true,
        saveUninitilized: true
    }
));


app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function(profile, cb) {
    cb(null, profile);
});

passport.deserializeUser(function(profile, cb) {
    cb(null, profile);
});

passport.use(new FacebookStrategy({
        clientID: config.FB_APP_ID,
        clientSecret: config.FB_APP_SECRET,
        callbackURL: config.SERVER_URL + "auth/facebook/callback"
    },
    function(accessToken, refreshToken, profile, cb) {
        process.nextTick(function() {
            return cb(null, profile);
        });
    }
));

app.get('/auth/facebook', passport.authenticate('facebook',{scope:'public_profile'}));


app.get('/auth/facebook/callback',
    passport.authenticate('facebook', { successRedirect : '/broadcast/broadcast', failureRedirect: '/broadcast' }));



app.set('view engine', 'ejs');



const credentials = {
    client_email: config.GOOGLE_CLIENT_EMAIL,
    private_key: config.GOOGLE_PRIVATE_KEY,
};

const sessionClient = new dialogflow.SessionsClient(
	{
		projectId: config.GOOGLE_PROJECT_ID,
		credentials
	}
);


const sessionIds = new Map();
const usersMap = new Map();

// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

app.use('/broadcast', broadcast);
app.use('/webviews', webviews);



// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));

	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

            // Secondary Receiver is in control - listen on standby channel
            if (pageEntry.standby) {
                // iterate webhook events from standby channel
                pageEntry.standby.forEach(event => {
                    const psid = event.sender.id;
                    const message = event.message;
                    console.log('message from: ', psid);
                    console.log('message to inbox: ', message);
                });
            }

            // Bot is in control - listen for messages
            if (pageEntry.messaging) {
                // Iterate over each messaging event
                pageEntry.messaging.forEach(function (messagingEvent) {
                    if (messagingEvent.optin) {
                        fbService.receivedAuthentication(messagingEvent);
                    } else if (messagingEvent.message) {
                        receivedMessage(messagingEvent);
                    } else if (messagingEvent.delivery) {
                        fbService.receivedDeliveryConfirmation(messagingEvent);
                    } else if (messagingEvent.postback) {
                        receivedPostback(messagingEvent);
                    } else if (messagingEvent.read) {
                        fbService.receivedMessageRead(messagingEvent);
                    } else if (messagingEvent.account_linking) {
                        fbService.receivedAccountLink(messagingEvent);
                    } else if (messagingEvent.pass_thread_control) {
                        // do something with the metadata: messagingEvent.pass_thread_control.metadata
                    } else {
                        console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                    }
                });
            }
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});


function setSessionAndUser(senderID) {
    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }

    if (!usersMap.has(senderID)) {
        userService.addUser(function(user){
            usersMap.set(senderID, user);
        }, senderID);
    }
}


function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

    setSessionAndUser(senderID);

	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
        fbService.handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to DialogFlow
        dialogflowService.sendTextQueryToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, messageText);
	} else if (messageAttachments) {
        fbService.handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    switch (quickReplyPayload) {
        case "LIVE_AGENT":
            fbService.sendPassThread(senderID);
            break;
        case 'NEWS_PER_WEEK':
            userService.newsletterSettings(function (updated) {
                if (updated) {
                    fbService.sendTextMessage(senderID, "Thank you for subscribing!" +
                        "If you want to usubscribe just write 'unsubscribe from newsletter'");
                } else {
                    fbService.sendTextMessage(senderID, "Newsletter is not available at this moment." +
                        "Try again later!");
                }
            }, 1, senderID);
            break;
        case 'NEWS_PER_DAY':
            userService.newsletterSettings(function (updated) {
                if (updated) {
                    fbService.sendTextMessage(senderID, "Thank you for subscribing!" +
                        "If you want to usubscribe just write 'unsubscribe from newsletter'");
                } else {
                    fbService.sendTextMessage(senderID, "Newsletter is not available at this moment." +
                        "Try again later!");
                }
            }, 2, senderID);
            break;
        default:
            dialogflowService.sendTextQueryToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, quickReplyPayload);
            break;
    }
}


function handleDialogFlowAction(sender, action, messages, contexts, parameters) {
	switch (action) {
        case "input.unknown":
            fbService.handleMessages(messages, sender);
            
            fbService.sendTypingOn(sender);

            //ask what user wants to do next
            setTimeout(function() {
                let responseText = "Can you please refrain your question or click the button to talk to a live agent. " +
                    "I'm just a bot.";

                let replies = [
                    {
                        "content_type": "text",
                        "title": "Live agent",
                        "payload": "LIVE_AGENT"
                    }
                ];

                fbService.sendQuickReply(sender, responseText, replies);
            }, 2000);

            break;
        case "talk.human":
            fbService.sendPassThread(sender);
            break;
        case "unsubscribe":
            userService.newsletterSettings(function(updated) {
                if (updated) {
                    fbService.sendTextMessage(sender, "You're unsubscribed. You can always subscribe back!");
                } else {
                    fbService.sendTextMessage(sender, "Newsletter is not available at this moment." +
                        "Try again later!");
                }
            }, 0, sender);
            break;
        case "buy.iphone":
            colors.readUserColor(function(color) {
                    let reply;
                    if (color === '') {
                        reply = 'In what color would you like to have it?';
                    } else {
                        reply = `Would you like to order it in your favourite color ${color}?`;
                    }
                fbService.sendTextMessage(sender, reply);

                }, sender
            )
            break;
        case "iphone_colors.fovourite":
            colors.updateUserColor(parameters.fields['color'].stringValue, sender);
            let reply = `Oh, I like it, too. I'll remember that.`;
            fbService.sendTextMessage(sender, reply);
            break;
        case "iphone_colors":
            colors.readAllColors(function (allColors) {
                let allColorsString = allColors.join(', ');
                let reply = `IPhone xxx is available in ${allColorsString}. What is your favourite color?`;
                fbService.sendTextMessage(sender, reply);
            });
            break;
        case "get-current-weather":
            if ( parameters.fields['geo-city'].stringValue!='') {

                weatherService(function(weatherResponse){
                    if (!weatherResponse) {
                        fbService.sendTextMessage(sender,
                            `No weather forecast available for ${parameters.fields['geo-city'].stringValue}`);
                    } else {
                        let reply = `${messages[0].text.text} ${weatherResponse}`;
                        fbService.sendTextMessage(sender, reply);
                    }


                }, parameters.fields['geo-city'].stringValue);
            } else {
                fbService.sendTextMessage(sender, 'No weather forecast available');
            }
        	break;
        case "faq-delivery":
            fbService.handleMessages(messages, sender);

            fbService.sendTypingOn(sender);

            //ask what user wants to do next
            setTimeout(function() {
                let buttons = [
                    {
                        type:"web_url",
                        url:"https://www.myapple.com/track_order",
                        title:"Track my order"
                    },
                    {
                        type:"phone_number",
                        title:"Call us",
                        payload:"+16505551234",
                    },
                    {
                        type:"postback",
                        title:"Keep on Chatting",
                        payload:"CHAT"
                    }
                ];

                fbService.sendButtonMessage(sender, "What would you like to do next?", buttons);
            }, 3000)

            break;
        case "detailed-application":
            let filteredContexts = contexts.filter(function (el) {
                return el.name.includes('job_application') ||
                    el.name.includes('job-application-details_dialog_context')
            });
            if (filteredContexts.length > 0 && contexts[0].parameters) {
                let phone_number = (isDefined(contexts[0].parameters.fields['phone-number'])

                    && contexts[0].parameters.fields['phone-number'] != '') ? contexts[0].parameters.fields['phone-number'].stringValue : '';
                let user_name = (fbService.isDefined(contexts[0].parameters.fields['user-name'])
                    && contexts[0].parameters.fields['user-name'] != '') ? contexts[0].parameters.fields['user-name'].stringValue : '';
                let previous_job = (fbService.isDefined(contexts[0].parameters.fields['previous-job'])
                    && contexts[0].parameters.fields['previous-job'] != '') ? contexts[0].parameters.fields['previous-job'].stringValue : '';
                let years_of_experience = (fbService.isDefined(contexts[0].parameters.fields['years-of-experience'])
                    && contexts[0].parameters.fields['years-of-experience'] != '') ? contexts[0].parameters.fields['years-of-experience'].stringValue : '';
                let job_vacancy = (fbService.isDefined(contexts[0].parameters.fields['job-vacancy'])
                    && contexts[0].parameters.fields['job-vacancy'] != '') ? contexts[0].parameters.fields['job-vacancy'].stringValue : '';


                if (phone_number == '' && user_name != '' && previous_job != '' && years_of_experience == '') {

                    let replies = [
                        {
                            "content_type":"text",
                            "title":"Less than 1 year",
                            "payload":"Less than 1 year"
                        },
                        {
                            "content_type":"text",
                            "title":"Less than 10 years",
                            "payload":"Less than 10 years"
                        },
                        {
                            "content_type":"text",
                            "title":"More than 10 years",
                            "payload":"More than 10 years"
                        }
                    ];
                    fbService.sendQuickReply(sender, messages[0].text.text[0], replies);
                } else if (phone_number != '' && user_name != '' && previous_job != '' && years_of_experience != ''
                    && job_vacancy != '') {

                    jobApplicationService(phone_number, user_name, previous_job, years_of_experience, job_vacancy);

                    fbService.handleMessages(messages, sender);

                } else {
                    fbService.handleMessages(messages, sender);
                }
            }
            break;
		default:
			//unhandled action, just send back the text
            fbService.handleMessages(messages, sender);
	}
}


function handleMessages(messages, sender) {
    let timeoutInterval = 1100;
    let previousType ;
    let cardTypes = [];
    let timeout = 0;
    for (var i = 0; i < messages.length; i++) {

        if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        } else if ( messages[i].message == "card" && i == messages.length - 1) {
            cardTypes.push(messages[i]);
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
        } else if ( messages[i].message == "card") {
            cardTypes.push(messages[i]);
        } else  {

            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        }

        previousType = messages[i].message;

    }
}

function handleDialogFlowResponse(sender, response) {
    let responseText = response.fulfillmentMessages.fulfillmentText;

    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    fbService.sendTypingOff(sender);

    if (fbService.isDefined(action)) {
        handleDialogFlowAction(sender, action, messages, contexts, parameters);
    } else if (fbService.isDefined(messages)) {
        fbService.handleMessages(messages, sender);
	} else if (responseText == '' && !fbService.isDefined(action)) {
		//dialogflow could not evaluate input.
        fbService.sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (fbService.isDefined(responseText)) {
        fbService.sendTextMessage(sender, responseText);
	}
}


async function resolveAfterXSeconds(x) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(x);
        }, x * 1000);
    });
}


async function greetUserText(userId) {
    let user = usersMap.get(userId);
    if (!user) {
        await resolveAfterXSeconds(2);
        user = usersMap.get(userId);
    }

    if (user) {
        sendTextMessage(userId, "Welcome " + user.first_name + '! ' +
            'I can answer frequently asked questions for you ' +
            'and I perform job interviews. What can I help you with?');
    } else {
        sendTextMessage(userId, 'Welcome! ' +
            'I can answer frequently asked questions for you ' +
            'and I perform job interviews. What can I help you with?');
    }
}



function sendFunNewsSubscribe(userId) {
    let responceText = "I can send you latest fun technology news, " +
        "you'll be on top of things and you'll get some laughts. How often would you like to receive them?";

    let replies = [
        {
            "content_type": "text",
            "title": "Once per week",
            "payload": "NEWS_PER_WEEK"
        },
        {
            "content_type": "text",
            "title": "Once per day",
            "payload": "NEWS_PER_DAY"
        }
    ];

    fbService.sendQuickReply(userId, responceText, replies);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v3.2/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

    setSessionAndUser(senderID);

	// The 'payload' param is a developer-defined field which is set in a postback 
	// button for Structured Messages. 
	var payload = event.postback.payload;

	switch (payload) {
        case 'FUN_NEWS':
            sendFunNewsSubscribe(senderID);
            break;
        case 'GET_STARTED':
            greetUserText(senderID);
            break;
        case 'JOB_APPLY':
            //get feedback with new jobs
            dialogflowService.sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'JOB_OPENINGS');
            break;
        case 'CHAT':
            //user wants to chat
            fbService.sendTextMessage(senderID, "I love chatting too. Do you have any other questions for me?");
            break;
		default:
			//unindentified payload
            fbService.sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}



/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var status = event.account_linking.status;
	var authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s " +
		"and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function (messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the 
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger' 
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function sendEmail(subject, content) {
	console.log('sending email!');
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(config.SENGRID_API_KEY);
    const msg = {
        to: config.EMAIL_TO,
        from: config.EMAIL_FROM,
        subject: subject,
        text: content,
        html: content,
    };
    sgMail.send(msg)
		.then(() => {
        console.log('Email Sent!');
    })
	.catch(error => {
		console.log('Email NOT Sent!');
		console.error(error.toString());
	});

}

function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
