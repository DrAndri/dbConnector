"use strict";
var express = require("express");
var calApp = express();
var rentApp = express();
var sio = require('socket.io');
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var FB = require('fb');
var moment = require('moment');
var schedule = require('node-schedule');
var Promise = require("bluebird");
var tbl_events = "Events";
var tbl_users = "Users";
var tbl_meniga = "Meniga";
var tbl_bands = "Bands";
var tbl_transactions = "Transactions";
var tbl_accounts = "Accounts";
var tbl_event_to_account = "event_to_account";
var tbl_recurring_events = "Recurring_events"
var not_authorized = "not_authorized";
var calendarPort = 3333;
var starmyriTestID = 226308061043610;
var starmyriID = 1624982647723413;
var starmyriAppID = 448772061955380;
var starmyriAppSecret = "11835fbd75ba01914333e0513aa47b18";
var epochDay = 24*60*60*1000;

let sendQuery = function (query, args, authorized){
    if(authorized) {
        return new Promise(
            function(resolve, reject) {
              pool.getConnection(function(err,connection){
                  if (err) {
                      console.log(err);
                      reject(err);
                  } else {
                      connection.query(query, args, function(err, rows) {
                          connection.release();
                          if(err) {
                              console.log(err);
                              //reject(err);
                          } else {
                               resolve(rows);
                          }
                      });
                      connection.on('error', function(err) {
                          connection.release();
                          console.log(query);
                          console.log(args);
                          console.log(err);
                          reject(err);
                      });
                  }
              });
            }
        );
    } else {
        console.log("USER UNAUTHORIZED");
        return Promise.reject(not_authorized);
    }
}

function generateGroupAccess(accessToken){
    return new Promise(
        function(resolve, reject) {
            FB.api('oauth/access_token', {
                client_id: starmyriAppID,
                client_secret: starmyriAppSecret,
                grant_type: 'fb_exchange_token',
                fb_exchange_token: accessToken
            }, function (res) {
                if(!res || res.error) {
                    console.log(!res ? 'error occurred' : res.error);
                    return;
                }

                var accessToken = res.access_token;
                var expires = res.expires ? res.expires : 0;
                resolve(accessToken);
            });
        }
    );
}



var calIO = sio.listen(calendarPort);
calIO.sockets.on('connection', function (socket) {
    var socketAuthorized = false;
    function sendSocketQuery(sql, args) {
        return sendQuery(sql, args, socketAuthorized)
        .catch(function(reason){
            console.log("PROMISE REJECTED:");
            console.log(reason);
            socket.emit("warning", {msg: reason});
        });
    }
    //Broadcasts creation, deletion and editing of an event
    function broadcastEvent(type, event){
        socket.broadcast.emit(type, {events: event});
        socket.emit(type, {events: event});
    }

    function createEventToAccount(eventId, accountId) {
        sendSocketQuery('INSERT INTO ' + tbl_event_to_account + ' (event_id, account_id) VALUES(?, ?)', [eventId, accountId]);
    }
    socket.on('getEvents', function (data) {
        sendSocketQuery('SELECT * FROM ' + tbl_events)
        .then(events => socket.emit("allEvents", {events: events}));
    });
    socket.on('saveEvent', function (data) {
        //TODO:
        //if(!args[1].published && args[0] != "delete"){
            //Post to facebook as the current user
        //    generateGroupAccess(args[1].accessToken, postToFB, args[1]);
        //}
        var event = data.events;
        event.series = null;
        var savePromise = sendSocketQuery('INSERT INTO ' + tbl_events + ' SET ?', event)
        .then(function(result) {
            event.id = result.insertId;
            broadcastEvent("events", [event]);
            if(data.charge){
                updateOrCreateNewAccount(data.events.title, [result.insertId]);
            }
        });
    });

    var updateOrCreateNewAccount = function(accountTitle, ids) {
        sendSocketQuery('SELECT * FROM ' + tbl_accounts + ' WHERE name = ?', accountTitle)
        .then(function(rows){
            if(rows[0])
                sendSocketQuery('UPDATE ' + tbl_accounts + ' SET unpaid_events = unpaid_events + ? WHERE name = ?', [ids.length, accountTitle])
                .then(ids.forEach(function(oneId){
                    createEventToAccount(oneId, rows[0].id)
                }));
            else
                sendSocketQuery('INSERT INTO ' + tbl_accounts + ' (id, name, open, unpaid_events) VALUES(?, ?, ?, ?)', [null, accountTitle, 1, ids.length])
                .then(result => ids.forEach(function(oneId){
                    createEventToAccount(oneId, result.insertId)
                }));
        });
    }
    socket.on('saveRecurringEventWithSeries', function (data){
        sendSocketQuery('SELECT series FROM ' + tbl_events + ' ORDER BY id DESC LIMIT 0, 1')
        .then(function(rows){
            var recurringEvent = data.recurringEvent;
            var events = [];
            var seriesStart = new Date(recurringEvent.seriesStart*1000);
            //add one day to include events on the last day of the series
            var seriesEnd = new Date(recurringEvent.seriesEnd*1000 + epochDay);
            var weekDaysToRender = recurringEvent.weekDays.split(",");
            var startDate = new Date(recurringEvent.start*1000);
            var endDate = new Date(recurringEvent.end*1000);
            var startEndDiff = endDate.getTime() - startDate.getTime();
            startDate.setFullYear(seriesStart.getFullYear(), seriesStart.getMonth(), seriesStart.getDate())
            startDate.setTime(startDate.getTime() - epochDay*7);
            while (startDate.getTime() < seriesEnd.getTime()){
                startDate.setTime(startDate.getTime() + epochDay*7);
                for (var j = 0; j < weekDaysToRender.length; j++) {
                    var distance = weekDaysToRender[j] - startDate.getDay();
                    distance *= epochDay;
                    startDate.setTime(startDate.getTime() + distance);
                    if(startDate.getTime() < seriesEnd.getTime() && startDate.getTime() > seriesStart.getTime()){
                        endDate.setTime(startDate.getTime() + startEndDiff);
                        var row = [startDate.getTime()/1000, endDate.getTime()/1000, recurringEvent.title, recurringEvent.body, recurringEvent.creator, recurringEvent.room, recurringEvent.published, rows[0].series+1];
                        events.push(row);
                    }
                };
            }
            insertEvents(events, data.charge);
        });
    });
    socket.on('saveRecurringEventWithDates', function (data){
        sendSocketQuery('SELECT series FROM ' + tbl_events + ' ORDER BY id DESC LIMIT 0, 1')
        .then(function(rows){
            var recurringEvent = data.recurringEvent;
            recurringEvent.start = new Date(recurringEvent.start*1000);
            recurringEvent.end = new Date(recurringEvent.end*1000);
            var startHours = recurringEvent.start.getHours();
            var startMinutes = recurringEvent.start.getMinutes();
            var difference = recurringEvent.end.getTime() - recurringEvent.start.getTime();
            var events = [];
            recurringEvent.recurringDates.forEach(function(oneDate){
                var startDate = new Date(oneDate);
                startDate.setHours(startHours);
                startDate.setMinutes(startMinutes);
                var endDate = new Date(startDate.getTime() + difference);
                var row = [startDate.getTime()/1000, endDate.getTime()/1000, recurringEvent.title, recurringEvent.body, recurringEvent.creator, recurringEvent.room, recurringEvent.published, rows[0].series+1];
                events.push(row);
            });
            insertEvents(events, data.charge);
        });
    });
    function insertEvents(events, charge){
        sendSocketQuery('INSERT INTO ' + tbl_events + ' (start, end, title, body, creator, room, published, series) VALUES ?', [events])
        .then(function(rows) {
            socket.emit('refresh');
            //TODO:implement charge and event_to_account
            console.log(rows);
            if(charge && events.length > 0){
                var ids = [];
                for (var i = 0; i < rows.affectedRows; i++) {
                    ids.push(rows.insertId++);
                }
                updateOrCreateNewAccount(events[0][2], ids);
            }
        });
    }

    socket.on('getAllEventsWithinTime', function (data) {
        sendSocketQuery('SELECT * FROM ' + tbl_events + ' WHERE (start > ? AND start < ?) OR (start < ? AND end > ?) OR (end > ? AND end < ?)', [data.start, data.end, data.start, data.end, data.start, data.end])
        .then(function(events) {
            socket.emit("events", {events: events})
        });
    });

    socket.on('editEvent', function (data) {
        var calEvent = data.events;
        calEvent.series = null;
        sendSocketQuery('UPDATE ' + tbl_events + ' SET ? WHERE id=?', [calEvent, calEvent.id])
        .then(function(rows) {
            broadcastEvent("editEvent", calEvent);
        });
    });
    socket.on('editRecurringEvent', function (data){
        sendSocketQuery('UPDATE ' + tbl_events + ' SET start=start+?, end=end+?, title=?, body=?, room=? WHERE series = ?', [data.startChange, data.endChange, data.title, data.body, data.room, data.series])
        .then(function(rows) {
            socket.emit('refresh');
        });
    });
    socket.on('deleteEvent', function (data) {
        var id = data.id;
        sendSocketQuery('DELETE FROM ' + tbl_events + ' WHERE id=?', id)
        .then(broadcastEvent("deleteEvent", id));
    });
    socket.on('deleteSeries', function (data) {
        var series = data.series;
        sendSocketQuery('DELETE FROM ' + tbl_events + ' WHERE series=?', series)
        .then(socket.emit("refresh"));
    });
    socket.on('checkLogin', function (data) {
        sendQuery('SELECT * FROM ' + tbl_users + ' WHERE fb_id=? AND disabled=0', data.id, true)
        .then(function(rows){
            if(rows.length != 0){
                socketAuthorized = true;
                //Emit login response and rent data
                if(rows[0].rentBalance === null){
                    console.log("band");
                    if(rows[0].band1) {
                        sendSocketQuery('SELECT rentBalance, bandName FROM ' + tbl_bands + ' WHERE id=?', rows[0].band1)
                        .then(bandRows => socket.emit("checkLogin", {response: true, id: rows[0].id, balance: bandRows[0].rentBalance, band: bandRows[0].bandName}));
                    } else {
                        //Tilraun gaman?
                        socket.emit("checkLogin", {response: true, id: rows[0].id, balance: rows[0].rentBalance, name: rows[0].name});
                    }
                } else{
                    //individual
                    socket.emit("checkLogin", {response: true, id: rows[0].id, balance: rows[0].rentBalance, name: rows[0].name});
                }
            } else {
                socket.emit("checkLogin", {response: false, id: data.id});
                console.log("EMAIL");
                var mailOptions = {
                    from: 'limur@starmyri.tk',
                    to: 'andrithorhalls@gmail.com',
                    subject: data.name + ' hafnað á starmyri.tk',
                    text: data.name + ' var að reyna að logga sig inn á starmyri.tk en var hafnað.'
                };
                transport.sendMail(mailOptions, function(err) {
                    console.log('Email sent!');
                    if(err)
                        console.log(err);
                });
                socket.disconnect(true);
            }
        });
    });
    socket.on('getUsernames', function(data) {
        //Emit user data
        var usersPromise = sendSocketQuery('SELECT name FROM ' + tbl_users + ' WHERE disabled=0');
        var bandsPromise = sendSocketQuery('SELECT bandName FROM ' + tbl_bands + ' WHERE disabled=0');
        Promise.join(usersPromise, bandsPromise, function(users, bands) {
            socket.emit('usernames', {users: users, bands: bands});
        });
    });
    socket.on('updateGroup', function (data) {
        generateGroupAccess(data.accessToken)
        .then(accessToken => updateGroupMembers(accessToken));
    });
    socket.on('getUsers', function (data){
        sendSocketQuery('SELECT b1.bandName AS band1, b2.bandName AS band2, b3.bandName AS band3, b4.bandName AS band4, t.db_id, t.name, t.rentBalance, t.rent FROM ' + tbl_users + " AS t LEFT JOIN " + tbl_bands + " AS b1 ON b1.id = t.band1 LEFT JOIN " + tbl_bands + " AS b2 ON b2.id = t.band2 LEFT JOIN " + tbl_bands + " AS b3 ON b3.id = t.band3 LEFT JOIN " + tbl_bands + " AS b4 ON b4.id = t.band4")
        .then(users => socket.emit('users', {users: users}));
    });
    socket.on('getBands', function (data){
        sendSocketQuery('SELECT * FROM ' + tbl_bands)
        .then(bands => socket.emit('bands', {bands: bands}));
    });
    socket.on('getAccounts', function (data){
        sendSocketQuery('SELECT * FROM ' + tbl_accounts)
        .then(accounts => socket.emit('accounts', {accounts: accounts}));
    });
    socket.on('getEventsFromNonRenters', function (data){
        sendSocketQuery('SELECT * FROM ' + tbl_event_to_account + ' LEFT JOIN ' + tbl_events + ' AS e ON e.id = event_id LEFT JOIN ' + tbl_accounts + ' AS a ON account_id = a.id')
        .then(events => socket.emit('nonRenterEvents', {events: events}));
    });
    socket.on('getTransactions', function (data){
        sendSocketQuery('SELECT v.name AS verifiedBy, a.name AS assignedTo, t.date, t.amount, t.paymentFrom, t.db_id FROM ' + tbl_transactions + ' AS t LEFT JOIN ' + tbl_users + ' AS v ON v.db_id = t.verifiedBy LEFT JOIN ' + tbl_users + ' AS a ON a.db_id = t.assignedTo WHERE t.date < ? OR t.verifiedBy IS NULL ORDER BY t.date DESC', moment()-5000)
        .then(transactions => socket.emit('transactions', {transactions: transactions}));
    });
    socket.on('verifyTransaction', function (data) {
        sendSocketQuery('UPDATE ' + tbl_transactions + ' SET verifiedBy = ?, assignedTo = ? WHERE db_id = ?', [data.verifiedBy, data.assignedTo, data.id]);
        sendSocketQuery('UPDATE ' + tbl_users + ' SET rentBalance = rentBalance + ? WHERE db_id = ?', [data.amount, data.assignedTo]);
    });
    socket.on('newTransaction', function (data) {
        console.log("NEW TRANSACTION");
        console.log(data);
        //TODO: insert object
        sendSocketQuery('INSERT INTO ' + tbl_transactions + ' VALUES (?, ?, ?, ?, ?, ?, ?)', [null, null, data.paymentTo, data.paymentFromName, data.amount, data.paymentFrom, moment().unix()]);
        sendSocketQuery('UPDATE ' + tbl_users + ' SET rentBalance = rentBalance - ? WHERE db_id = ?', [data.amount, data.paymentFrom]);
        sendSocketQuery('UPDATE ' + tbl_users + ' SET rentBalance = rentBalance + ? WHERE db_id = ?', [data.amount, data.paymentTo]);
    });
});
console.log("Calendar listening on port " + calendarPort);
var mysql = require('mysql');
var pool = mysql.createPool({
    connectionLimit : 3000,
    host     : 'localhost',
    user     : 'calendar_user',
    password : 'Besta!Calendar1',
    database : 'Starmyri'
});
process.setMaxListeners(0);

var transport = nodemailer.createTransport(smtpTransport({
    host: "smtp.gmail.com",
    secure: true,
    port: 465,
    auth: {
        user: 'andrithorhalls@gmail.com',
        pass: 'vrcmpfqgwzrypsfm'
    },
    tls: {
        rejectUnauthorized: false
    }
}));

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

function updateGroupMembers(accessToken){
    FB.setAccessToken(accessToken);
    FB.api("/"+starmyriID+"/members?limit=50", function (response) {
        if (response && !response.error){
            var ids = [];
            var names = [];
            for(var i = 0; i<response.data.length; i++){
                ids[i] = response.data[i].id;
                names[i] = response.data[i].name;
            }
            sendQuery('UPDATE ' + tbl_users + ' SET disabled=1 WHERE auto_disable_enable = 1 AND fb_id NOT IN (' + ids.join() + ')', null, true);
            if(ids.length > 1){
                for (var i = 0; i < ids.length; i++) {
                    sendQuery('INSERT INTO ' + tbl_users + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE disabled = IF(auto_disable_enable = 1, 0, VALUES(disabled))', [null, ids[i], names[i], null, null, null, null, null, null, 0, 1], true);
                };
            }
        }
    });
}


function cmd_exec(cmd, args, cb_stdout, cb_end, env) {
  var spawn = require('child_process').spawn,
    child = spawn(cmd, args, {env: env}),
    me = this;
  me.exit = 0;  // Send a cb to set 1 when cmd exits
  child.stdout.on('data', function (data) { cb_stdout(me, data) });
  child.stdout.on('end', function () { cb_end(me) });
}

function getCurrentTime(){
    var today = new Date();
    var year = today.getFullYear();
    var month = today.getMonth()+1;
    var day = today.getDate();
    //var hour = today.getHours();
    //var minutes = today.getMinutes();
    //var seconds = today.getSeconds();
    return year + "-" + month + "-" + day;// + " " + hour + ":" + minutes + ":" + seconds;
}

function updateUserRentBalance(rows, db_id, amount) {
    sendQuery("UPDATE " + tbl_users + " SET rentBalance = rentBalance + ? WHERE db_id = ?", [amount, db_id], true);
}

function createTransaction(rows, name, id, amount, date){
    var insertQuery = "INSERT INTO " + tbl_transactions + " VALUES (?, ?, ?, ?, ?, ?, ?)";
    if(rows[0]) {
        sendQuery(insertQuery, [null, id, rows[0].db_id, name, amount, 1, moment(date).unix()], true)
        .then(result => updateUserRentBalance(rows, rows[0].db_id, amount));
    } else if(amount < 0) {
        sendQuery(insertQuery, [null, id, null, name, amount, 1, moment(date).unix()], true)
        .then(result => updateUserRentBalance(rows, rows[0].db_id, amount));
    } else {
        sendQuery(insertQuery, [null, id, null, name, amount, null, moment(date).unix()], true);
    }
}

function parseTransactions(meniga, currentTime){
    console.log("Parsing");
    if(meniga.stdout != null){
        var allTransactions = JSON.parse(meniga.stdout.substring(9));
        for (var i = 0; i < allTransactions.length; i++) {
            if(allTransactions[i].AccountId == 295036){
                var nameIndex = 0;
                if(allTransactions[i].Text.indexOf(":") > 0){
                    nameIndex = allTransactions[i].Text.indexOf(" ") + 1;
                }
                let name = allTransactions[i].Text.substring(nameIndex);
                let amount = allTransactions[i].Amount;
                let id = allTransactions[i].Id;
                let date = allTransactions[i].Date;
                sendQuery("SELECT db_id FROM " + tbl_users + " WHERE name = ?", name, true)
                .then(rows => createTransaction(rows, name, id, amount, date));
            }
        };
    }
    console.log("Parsing done, parsed " + allTransactions.length + " transactions");
    sendQuery("UPDATE " + tbl_meniga + " SET date = ? WHERE id=1", currentTime, true);
}

function getAndProcessTransactions(rows, currentTime){
    console.log("Getting transactions");
    var lastUpdateMoment = moment(rows[0].date, "YYYY-M-D");
    var subtracted = lastUpdateMoment.subtract(2, 'days').format('YYYY-MM-DD');
    var spawn = require('child_process').spawn;
    var env = {MENIGA_USERNAME: "andrithorhalls@gmail.com", MENIGA_PASSWORD: "Superman12", startTime: subtracted, endTime: currentTime};
    var meniga = new cmd_exec('/usr/bin/node', ['/var/www/meniga-client/examples/transactions.js'],
        function (me, data) {me.stdout += data.toString();},
        function (me) {me.exit = 1;parseTransactions(meniga, currentTime)},
        env
    );
}
//run once every hour
var getTransactions = schedule.scheduleJob('0 */6 * * *', function(){
    var currentTime = getCurrentTime();
    sendQuery("SELECT * FROM Meniga", currentTime, true)
    .then(rows => getAndProcessTransactions(rows, currentTime));
});
//run once every month
var j = schedule.scheduleJob('0 0 1 * *', function(){
    sendQuery("UPDATE " + tbl_bands + " SET rentBalance=rentBalance - rent", null, true);
    sendQuery("UPDATE " + tbl_users + " SET rentBalance=rentBalance - rent", null, true);
});
