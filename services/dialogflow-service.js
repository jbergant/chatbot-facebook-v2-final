const dialogflow = require('dialogflow');
const config = require('../config');
const fbService = require('./fb-service');
// Import the JSON to gRPC struct converter
const structjson = require('./structjson.js');

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


module.exports = {

    async sendTextQueryToDialogFlow(sessionIds, handleDialogFlowResponse, sender, text, params = {}) {
        const sessionPath = sessionClient.sessionPath(config.GOOGLE_PROJECT_ID, sessionIds.get(sender));
        fbService.sendTypingOn(sender);

        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: text,
                    languageCode: config.DF_LANGUAGE_CODE,
                },
            },
            queryParams: {
                payload: {
                    data: params
                }
            }
        };
        const responses = await sessionClient.detectIntent(request);

        const result = responses[0].queryResult;
        handleDialogFlowResponse(sender, result);

    },


    async sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, event, params = {}) {
        const sessionPath = sessionClient.sessionPath(config.GOOGLE_PROJECT_ID, sessionIds.get(sender));
        const request = {
            session: sessionPath,
            queryInput: {
                event: {
                    name: event,
                    parameters: structjson.jsonToStructProto(params), //Dialogflow's v2 API uses gRPC. You'll need a jsonToStructProto method to convert your JavaScript object to a proto struct.
                    languageCode: config.DF_LANGUAGE_CODE,
                },
            }
        };


        const responses = await sessionClient.detectIntent(request);

        const result = responses[0].queryResult;
        handleDialogFlowResponse(sender, result);

    }


}

