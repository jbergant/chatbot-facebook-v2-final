'use strict';
const request = require('request');
const crypto = require('crypto');
const config = require('../config');
module.exports = {
    sendPassThread: function(senderID) {
        request(
            {
                uri: "https://graph.facebook.com/v2.6/me/pass_thread_control",
                qs: { access_token: config.FB_PAGE_TOKEN },
                method: "POST",
                json: {
                    recipient: {
                        id: senderID
                    },
                    target_app_id: config.FB_PAGE_INBOX_ID // ID in the page inbox setting under messenger platform
                }
            }
        );
    },

    handleMessages: function(messages, sender){
        let self = module.exports;
        let timeoutInterval = 1100;
        let previousType ;
        let cardTypes = [];
        let timeout = 0;
        for (var i = 0; i < messages.length; i++) {

            if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
                timeout = (i - 1) * timeoutInterval;
                setTimeout(self.handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
                timeout = i * timeoutInterval;
                setTimeout(self.handleMessage.bind(null, messages[i], sender), timeout);
            } else if ( messages[i].message == "card" && i == messages.length - 1) {
                cardTypes.push(messages[i]);
                timeout = (i - 1) * timeoutInterval;
                setTimeout(self.handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
            } else if ( messages[i].message == "card") {
                cardTypes.push(messages[i]);
            } else  {

                timeout = i * timeoutInterval;
                setTimeout(self.handleMessage.bind(null, messages[i], sender), timeout);
            }

            previousType = messages[i].message;

        }
    },

    handleMessageAttachments: function(messageAttachments, senderID){
        let self = module.exports;
        //for now just reply messageAttachments[0].payload.url
        self.sendTextMessage(senderID, "Attachment received. Thank you.");
    },

    //https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
    handleEcho: function(messageId, appId, metadata) {
        // Just logging message echoes to console
        console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
    },

    handleMessage: function(message, sender) {
        let self = module.exports;
        switch (message.message) {
            case "text": //text
                message.text.text.forEach((text) => {
                    if (text !== '') {
                        self.sendTextMessage(sender, text);
                    }
                });
                break;
            case "quickReplies": //quick replies
                let replies = [];
                message.quickReplies.quickReplies.forEach((text) => {
                    let reply =
                        {
                            "content_type": "text",
                            "title": text,
                            "payload": text
                        }
                    replies.push(reply);
                });
                self.sendQuickReply(sender, message.quickReplies.title, replies);
                break;
            case "image": //image
                self.sendImageMessage(sender, message.image.imageUri);
                break;
        }
    },

    handleCardMessages: function(messages, sender) {

        let self = module.exports;
        let elements = [];
        for (var m = 0; m < messages.length; m++) {
            let message = messages[m];

            let buttons = [];
            for (var b = 0; b < message.card.buttons.length; b++) {
                let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
                let button;
                if (isLink) {
                    button = {
                        "type": "web_url",
                        "title": message.card.buttons[b].text,
                        "url": message.card.buttons[b].postback
                    }
                } else {
                    button = {
                        "type": "postback",
                        "title": message.card.buttons[b].text,
                        "payload": message.card.buttons[b].postback
                    }
                }
                buttons.push(button);
            }


            let element = {
                "title": message.card.title,
                "image_url":message.card.imageUri,
                "subtitle": message.card.subtitle,
                "buttons": buttons
            };
            elements.push(element);
        }

        self.sendGenericMessage(sender, elements);
    },

    /*
     * Message Read Event
     *
     * This event is called when a previously-sent message has been read.
     * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
     *
     */
    receivedMessageRead: function(event) {
        var senderID = event.sender.id;
        var recipientID = event.recipient.id;

        // All messages before watermark (a timestamp) or sequence have been seen.
        var watermark = event.read.watermark;
        var sequenceNumber = event.read.seq;

        console.log("Received message read event for watermark %d and sequence " +
            "number %d", watermark, sequenceNumber);
    },

    /*
     * Account Link Event
     *
     * This event is called when the Link Account or UnLink Account action has been
     * tapped.
     * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
     *
     */
    receivedAccountLink: function(event) {
        var senderID = event.sender.id;
        var recipientID = event.recipient.id;

        var status = event.account_linking.status;
        var authCode = event.account_linking.authorization_code;

        console.log("Received account link event with for user %d with status %s " +
            "and auth code %s ", senderID, status, authCode);
    },


    /*
     * Delivery Confirmation Event
     *
     * This event is sent to confirm the delivery of a message. Read more about
     * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
     *
     */
    receivedDeliveryConfirmation: function(event) {
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
    },






    /*
     * Authorization Event
     *
     * The value for 'optin.ref' is defined in the entry point. For the "Send to
     * Messenger" plugin, it is the 'data-ref' field. Read more at
     * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
     *
     */
    receivedAuthentication: function(event) {
        var senderID = event.sender.id;
        var recipientID = event.recipient.id;
        var timeOfAuth = event.timestamp;
        let self = module.exports;
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
        self.sendTextMessage(senderID, "Authentication successful");
    },

    /*
     * Verify that the callback came from Facebook. Using the App Secret from
     * the App Dashboard, we can verify the signature that is sent with each
     * callback in the x-hub-signature field, located in the header.
     *
     * https://developers.facebook.com/docs/graph-api/webhooks#setup
     *
     */
    verifyRequestSignature: function(req, res, buf) {
        var signature = req.headers["x-hub-signature"];
        console.log('verifyRequestSignature');
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
                throw new
                Error("Couldn't validate the request signature.");
                console.log("Couldn't validate the request signature.");
            }
        }
    },






    /*
     * Send a message with a Receipt
     *
     */
    sendReceiptMessage: function(recipientId, recipient_name, currency, payment_method,
                                 timestamp, elements, address, summary, adjustments) {
        let self = module.exports;
        // Generate a random receipt ID as the API requires a unique ID
        var receiptId = "order" + Math.floor(Math.random() * 1000);

        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "receipt",
                        recipient_name: recipient_name,
                        order_number: receiptId,
                        currency: currency,
                        payment_method: payment_method,
                        timestamp: timestamp,
                        elements: elements,
                        address: address,
                        summary: summary,
                        adjustments: adjustments
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send a message with Quick Reply buttons.
     *
     */
    sendQuickReply: function(recipientId, text, replies, metadata) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                text: text,
                metadata: self.isDefined(metadata)?metadata:'',
                quick_replies: replies
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send an image using the Send API.
     *
     */
    sendImageMessage: function(recipientId, imageUrl) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "image",
                    payload: {
                        url: imageUrl
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send a Gif using the Send API.
     *
     */
    sendGifMessage: function(recipientId) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "image",
                    payload: {
                        url: config.SERVER_URL + "/assets/instagram_logo.gif"
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send audio using the Send API.
     *
     */
    sendAudioMessage: function(recipientId) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "audio",
                    payload: {
                        url: config.SERVER_URL + "/assets/sample.mp3"
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send a video using the Send API.
     * example videoName: "/assets/allofus480.mov"
     */
    sendVideoMessage: function(recipientId, videoName) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "video",
                    payload: {
                        url: config.SERVER_URL + videoName
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    /*
     * Send a video using the Send API.
     * example fileName: fileName"/assets/test.txt"
     */
    sendFileMessage: function(recipientId, fileName) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "file",
                    payload: {
                        url: config.SERVER_URL + fileName
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },



    /*
     * Send a button message using the Send API.
     *
     */
    sendButtonMessage: function(recipientId, text, buttons) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: text,
                        buttons: buttons
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },


    sendGenericMessage: function(recipientId, elements) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: elements
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },
    /*
     * Send a read receipt to indicate the message has been read
     *
     */
    sendReadReceipt: function(recipientId) {
        let self = module.exports;
        console.log("Sending a read receipt to mark message as seen");

        var messageData = {
            recipient: {
                id: recipientId
            },
            sender_action: "mark_seen"
        };

        self.callSendAPI(messageData);
    },
    /*
     * Turn typing indicator on
     *
     */
    sendTypingOn: function(recipientId) {
        let self = module.exports;
        console.log("Turning typing indicator on");

        var messageData = {
            recipient: {
                id: recipientId
            },
            sender_action: "typing_on"
        };

        self.callSendAPI(messageData);
    },

    /*
     * Turn typing indicator off
     *
     */
    sendTypingOff: function(recipientId) {
        let self = module.exports;
        console.log("Turning typing indicator off");
        var messageData = {
            recipient: {
                id: recipientId
            },
            sender_action: "typing_off"
        };

        self.callSendAPI(messageData);
    },


    /*
     * Send a message with the account linking call-to-action
     *
     */
    sendAccountLinking: function(recipientId) {
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: "Welcome. Link your account.",
                        buttons: [{
                            type: "account_link",
                            url: config.SERVER_URL + "/authorize"
                        }]
                    }
                }
            }
        };

        self.callSendAPI(messageData);
    },

    sendTextMessage: function(recipientId, text) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                text: text
            }
        }
        self.callSendAPI(messageData);
    },


    /*
     * Call the Send API. The message data goes in the body. If successful, we'll
     * get the message id in a response
     *
     */
    callSendAPI: function(messageData) {
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
    },

    isDefined: function(obj) {
        if (typeof obj == 'undefined') {
            return false;
        }

        if (!obj) {
            return false;
        }

        return obj != null;
    }

}