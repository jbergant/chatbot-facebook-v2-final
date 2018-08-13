'use strict';
const request = require('request');
const config = require('../config');


module.exports = function(callback, geoCity){
    request({
        url: 'http://api.openweathermap.org/data/2.5/weather', //URL to hit
        qs: {
            appid: config.WEATHER_API_KEY,
            q: geoCity
        }, //Query string data
    }, function(error, response, body){
        if(!error && response.statusCode == 200) {
            let weather = JSON.parse(body);
            if (weather.hasOwnProperty("weather")) {

                callback(weather["weather"][0]["description"]);
            } else {
                callback(null);
            }
        } else {
            callback(null);
            console.error(response.error);
        }
    });
}