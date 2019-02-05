var FB = require('fb');
var starmyriTestID = 226308061043610;
var starmyriID = 1624982647723413;
var starmyriAppID = 448772061955380;
var starmyriAppSecret = "11835fbd75ba01914333e0513aa47b18";

function init(){

}

function generateAppAccess(accessToken){
    return new Promise(
        function(resolve, reject) {
            FB.api('oauth/access_token', {
                client_id: starmyriAppID,
                client_secret: starmyriAppSecret,
                redirect_uri: "https://starmyri.ga",
                grant_type: "client_credentials"
            }, function (res) {
                if(!res || res.error) {
                    console.log(!res ? 'error occurred' : res.error);
                    reject("Error generating facebook group access");
                    return;
                }
                var groupAccessToken = res.access_token;
                var expires = res.expires ? res.expires : 0;
                resolve(groupAccessToken);
            });
        }
    );
}

function validateAccessToken(groupAccessToken, id, accessToken){
    return new Promise(
        function(resolve, reject) {
            FB.api('debug_token', 'get', { input_token: accessToken, access_token: groupAccessToken }, function (res) {
                if(!res || res.error) {
                    console.log(!res ? 'error occurred' : res.error);
                    reject();
                } else if(res.data.is_valid && res.data.user_id == id){
                    resolve();
                } else {
                    reject();
                }
            });
        }
    );
}

function postToFB(accessToken, calEvent){
    var fbMessage = "Hæ krakkar! \n";
    calEvent.start = new Date(calEvent.start*1000);
    calEvent.end = new Date(calEvent.end*1000);
    fbMessage += calEvent.title + " ætla að æfa á "  + calEvent.start.toDateString().substring(0, calEvent.start.toDateString().length - 5) + " frá " + calEvent.start.getHours() + ":" + (calEvent.start.getMinutes()<10?'0':'') + calEvent.start.getMinutes() + " til " + calEvent.end.getHours() + ":" + (calEvent.end.getMinutes()<10?'0':'') + calEvent.end.getMinutes();
    if(calEvent.room == "L")
        fbMessage += " í vinstra rýminu";
    else if(calEvent.room == "R")
        fbMessage += " í hægra rýminu";
    else if(calEvent.room == "B")
        fbMessage += " í báðum rýmunum";
    fbMessage += ".";
    FB.setAccessToken(accessToken);
    FB.api(starmyriID + '/feed', 'post', { message: fbMessage }, function (res) {
        if(!res || res.error) {
            console.log(!res ? 'error occurred' : res.error);
            return;
        }
    });
}

function getGroupMembers(accessToken){
    return new Promise(
        function(resolve, reject) {
            FB.setAccessToken(accessToken);
            FB.api("/"+starmyriID+"/members?limit=50", function (response) {
                if (response && !response.error){
                    var ids = [];
                    var names = [];
                    for(var i = 0; i<response.data.length; i++){
                        ids[i] = response.data[i].id;
                        names[i] = response.data[i].name;
                    }
                    resolve(ids, names);
                }
            });
        }
    );
}

module.exports = {
  init: init,
  generateAppAccess: generateAppAccess,
  validateAccessToken: validateAccessToken,
  getGroupMembers: getGroupMembers
};
