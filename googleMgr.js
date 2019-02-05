var google = require('googleapis');
var privatekey = require("./privatekey.json");
var jwtClient;
var calendar = google.calendar('v3');

var verifier = require('google-id-token-verifier');
var clientId = "585554813290-1plmpaq95nfmqsjpded8j02d5cbau3ht.apps.googleusercontent.com";



function init(){
    // configure a JWT auth client
    jwtClient = new google.auth.JWT(
           privatekey.client_email,
           privatekey.project_id,
           privatekey.private_key,
           ['https://www.googleapis.com/auth/calendar']);
    //authenticate request
    jwtClient.authorize(function (err, tokens) {
     if (err) {
       console.log(err);
       return;
     } else {
       console.log("Successfully connected!");
     }
    });
}


function validateAccessToken(idToken, googleId) {
  return new Promise(
      function(resolve, reject) {
        verifier.verify(idToken, clientId, function (err, tokenInfo) {
          if (!err) {
            //console.log(tokenInfo);
            if(googleId == tokenInfo.sub){
              resolve(tokenInfo);
            } else {
              reject("Google ID does not match");
            }
          } else {
            console.log("Google token validation error:");
            console.log(err);
            console.log(tokenInfo);
            reject("Error verifying google token");
          }
        });
      });
}

function createEvent(e, attendees) {
  return new Promise(
      function(resolve, reject) {
          var room = "";
          if(e.room == "B")
            room = "Both rooms";
          else if(e.room == "R")
            room = "Live room";
          else if(e.room == "L")
            room = "Control room";
          var event = {
            'summary': e.title,
            'location': 'Starmýri 2a, ' + room,
            'description': e.body,
            'start': {
              'dateTime': new Date(e.start*1000).toISOString(),
              'timeZone': 'Atlantic/Reykjavik',
            },
            'end': {
              'dateTime': new Date(e.end*1000).toISOString(),
              'timeZone': 'Atlantic/Reykjavik',
            },
            //'recurrence': [
            //  'RRULE:FREQ=DAILY;COUNT=2'
            //],
            'attendees': attendees,
            'reminders': {
              'useDefault': true
            },
          };

          calendar.events.insert({
            auth: jwtClient,
            calendarId: 'primary',
            resource: event,
          }, function(err, event) {
            if (err) {
              reject('There was an error contacting the Calendar service: ' + err);
              return;
            }
            resolve(event.id);
          });
    });
}

module.exports = {
  init: init,
  createEvent: createEvent,
  validateAccessToken: validateAccessToken
};
