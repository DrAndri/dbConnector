"use strict";
require('events').EventEmitter.prototype._maxListeners = 100;
var express = require("express");
var app = express();
var mysql = require('mysql');
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var session = require('express-session');
var sharedsession = require('express-socket.io-session');
var MySQLStore = require('express-mysql-session')(session);
var cookieParser = require('cookie-parser');
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var moment = require('moment');
var schedule = require('node-schedule');
var Promise = require("bluebird");
var co = require('co');
var _ = require('lodash');
var MenigaClient = require('./meniga-client/index');
var googleMgr = require("./googleMgr");
var facebookMgr = require("./facebookMgr");

var tbl_events = "Events";
var tbl_users = "Users";
var tbl_meniga = "Meniga";
var tbl_bands = "Bands";
var tbl_transactions = "Transactions";
var tbl_accounts = "Accounts";
var tbl_event_to_account = "event_to_account";
var tbl_recurring_events = "Recurring_events"
var tbl_users_to_bands = "user_to_band";
var not_authorized = "not_authorized";
var calendarPort = 3333;
var epochDay = 24*60*60*1000;
var mysqlUser = 'calendar_user'
var mysqlPass = 'Besta!Calendar1'
var mysqlDatabase = 'Starmyri'
var cookieSecret = 'gottLeyndarmal';

var NO_USER = 0;

process.setMaxListeners(0);

var pool = mysql.createPool({
    connectionLimit : 3000,
    host     : 'localhost',
    user     : mysqlUser,
    password : mysqlPass,
    database : mysqlDatabase
});

app.set('trust proxy', 1);

var sessionStore = new MySQLStore({createDatabaseTable: true}/* session store options */, pool);

var sessionInstance = session({
    key: 'starmyri',
		secret: cookieSecret,
		resave: true,
		saveUninitialized: true,
    store: sessionStore,
    cookie: {
      maxAge: 3600000 * 24 * 30 * 2
    }
	});

app.use(sessionInstance);


app.use(cookieParser(cookieSecret));

app.use("/", express.static(__dirname + '/html'));

googleMgr.init();

let sendQuery = function (query, args, authorized){
  //TODO: temp skip login
    if(true/*authorized*/) {
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

io.use(
	sharedsession(sessionInstance, {
		autoSave: true
	})
);

io.on('connection', function(socket){
    var facebookAuthenticated;
    var googleAuthenticated;
    var authenticated;
    var currentUser = {};
    var tempGoogleProfile = {};

    if(socket.handshake.session && socket.handshake.session.currentUser) {
        currentUser = socket.handshake.session.currentUser;
        authenticated = true;
        console.log("Sess");
        socket.emit("checkLogin", {response: true, user: currentUser});
      }
    function sendSocketQuery(sql, args) {
        return sendQuery(sql, args, authenticated)
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
        var event = data.events;
        event.series = null;
        insertEvents([event], data.charge, true);
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
                        var event = getEvent(startDate.getTime()/1000, endDate.getTime()/1000, recurringEvent.title, recurringEvent.body, recurringEvent.creator, recurringEvent.room, rows[0].series+1, recurringEvent.attendees);
                        events.push(event);
                    }
                };
            }
            insertEvents(events, data.charge, false);
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
                var event = getEvent(startDate.getTime()/1000, endDate.getTime()/1000, recurringEvent.title, recurringEvent.body, recurringEvent.creator, recurringEvent.room, rows[0].series+1, recurringEvent.attendees);
                events.push(event);
            });
            insertEvents(events, data.charge, false);
        });
    });
    function insertEvents(events, charge, broadcast){
        var eventRows = [];
        var attendees;
        events.forEach(function(r) {
            attendees = [];
            var eventRow = [r.start, r.end, r.title, r.body, r.creator, r.room, r.series];
            eventRows.push(eventRow);
            r.attendees.forEach(function(attendee){
              attendees.push({'email': attendee})
            });
        });
        sendSocketQuery('INSERT INTO ' + tbl_events + ' (start, end, title, body, creator, room, series) VALUES ?', [eventRows])
        .then(function(rows) {
            if(broadcast) {
                broadcastEvent("events", events);
            } else {
              socket.emit('refresh');
            }
            for (var i = 0; i < events.length; i++) {
              var event = events[i];
              event.id = rows.insertId + i;
              googleMgr.createEvent(events[i], attendees)
              .then(function(google_id){
                sendSocketQuery('UPDATE ' + tbl_events + ' SET google_id=? WHERE id=?', [google_id, event.id])
              });
            }

            //TODO:test charge and event_to_account
            if(charge && events.length > 0){
                var ids = [];
                for (var i = 0; i < rows.affectedRows; i++) {
                    ids.push(rows.insertId++);
                }
                updateOrCreateNewAccount(events[0][2], ids);
            }
        });
    }

    function getEvent(start, end, title, body, creator, room, series, attendees) {
      var event = {};
      event.start = start;
      event.end = end;
      event.title = title;
      event.body = body;
      event. creator = creator;
      event.room = room;
      event.series = series;
      event.attendees = attendees;
      return event;
    }

    socket.on('getAllEventsWithinTime', function (data) {
      console.log("FETCHING EVENTS");
        sendSocketQuery('SELECT * FROM ' + tbl_events + ' WHERE (start > ? AND start < ?) OR (start < ? AND end > ?) OR (end > ? AND end < ?)', [data.start, data.end, data.start, data.end, data.start, data.end])
        .then(function(events) {
            socket.emit("events", {events: events})
        });
    });

    socket.on('editEvent', function (data) {
        var calEvent = data.events;
        calEvent.series = null;
        delete calEvent.attendees;
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
    socket.on('signOut', function (data) {
      authenticated = false;
      if (socket.handshake.session.currentUser) {
          delete socket.handshake.session.currentUser;
          socket.handshake.session.save();
      }
    });
    socket.on('checkLogin', function (data) {
      console.log("CHECK");
      console.log(data);
      if(authenticated && currentUser) {
        console.log("ALREADY AUTHENTICATED");
        socket.emit("checkLogin", {response: true, user: currentUser});
        return;
      } else if(socket.handshake.session && socket.handshake.session.currentUser) {
        console.log("SESSION");
          currentUser = socket.handshake.session.currentUser;
          authenticated = true;
          socket.emit("checkLogin", {response: true, user: currentUser});
      } else {
        console.log("NO SESSH");
          var authPromise;
          var dbPromise;
          if(data.facebookAccessToken) {
            authPromise = facebookMgr.generateAppAccess(data.facebookAccessToken)
            .then(accessToken => facebookMgr.validateAccessToken(accessToken, data.fbId, data.facebookAccessToken));
            dbPromise = checkFacebookUser(data.fbId);
          } else if(data.googleIdToken) {
            authPromise = googleMgr.validateAccessToken(data.googleIdToken, data.googleId);
            dbPromise = checkGoogleUser(data.googleId);
          } else {
            //TEMP SKIP LOGIN
            authenticated = true;
            currentUser = {db_id: 1, fb_id: 102904983383086, google_id: null, name: "Starmýri", email: null, rentBalance: "???", rent: null, disabled: 0}
            socket.emit("checkLogin", {response: true});
          }

          Promise.join(dbPromise, authPromise, function(dbArgs, authArgs) {
              if(data.googleIdToken) {
                  googleAuthenticated = true;
                  authenticated = true;
              } else if(data.facebookAccessToken) {
                  facebookAuthenticated = true;
                  authenticated = true;
                  if(tempGoogleProfile.googleId) {
                    shouldLinkAccounts(tempGoogleProfile);
                  }
              }
              populateBandsOnUsers([currentUser])
              .then(function(user){
                socket.emit("checkLogin", {response: true, user: currentUser});
              });
          }).catch((error) => {
            console.log("ERROR");
            console.log(error);
            if(data.googleIdToken) {
                googleAuthenticated = false;
                if(error == NO_USER) {
                  if(authenticated === true) {
                    shouldLinkAccounts(data);
                  } else {
                    tempGoogleProfile = data;
                  }
                }
            } else if(data.facebookAccessToken) {
                facebookAuthenticated = false;
            }
            if(googleAuthenticated === false || facebookAuthenticated === false) {
                socket.emit("checkLogin", {response: false, profile: data});
                var mailOptions = {
                    from: 'limur@starmyri.tk',
                    to: 'andrithorhalls@gmail.com',
                    subject: data.name + ' hafnað á starmyri.tk',
                    text: data.name + ' var að reyna að logga sig inn á starmyri.tk en var hafnað. Facebook: ' + data.fbId + ' Google: ' + data.googleId
                };
                transport.sendMail(mailOptions, function(err) {
                    console.log('Email sent!');
                    if(err)
                        console.log(err);
                });
                //socket.disconnect(true);
              }
          });
        }
    });

    socket.on('linkAccounts', linkAccounts);

    function linkAccounts(data) {
        if(currentUser.db_id == data.userId) {
            sendSocketQuery('UPDATE ' + tbl_users + ' SET google_id=?, email=? WHERE db_id = ?', [data.googleId, data.email, data.userId])
            .then(function(rows) {
                socket.emit('accountsLinked', {user: rows[0]});
            });
        }
    }

    function shouldLinkAccounts(data) {
        if(currentUser.name == data.name){
            //Names are the same, linking accounts
            linkAccounts({googleId: data.googleId, userId: currentUser.db_id, email: data.email})
        } else {
          socket.emit("shouldLinkAccounts", {googleId: data.googleId, fbId: currentUser.fb_id, userId: currentUser.db_id, email: data.email});
        }
    }

    function checkFacebookUser(id) {
        return sendQuery('SELECT * FROM ' + tbl_users + ' WHERE fb_id=? AND disabled=0', id, true)
        .then(afterLoginPromise);
    }

    function checkGoogleUser(id) {
        return sendQuery('SELECT * FROM ' + tbl_users + ' WHERE google_id=? AND disabled=0', id, true)
        .then(afterLoginPromise);
    }

    function afterLoginPromise(rows) {
        return new Promise(function(resolve, reject) {
            if(rows.length != 0){
                //Emit login response and rent data
                if(rows[0].rentBalance === null){
                  //TODO: test this
                    if(rows[0].bands && rows[0].bands[0].id) {
                        resolve(rows[0].db_id, rows[0].bands[0].rentBalance, rows[0].bands[0].bandName);/*socket.emit("checkLogin", {response: true, id: rows[0].id, balance: bandRows[0].rentBalance, band: bandRows[0].bandName}));*/
                    } else {
                        //Tilraun gaman?
                        resolve(rows[0].db_id, rows[0].rentBalance, rows[0].name);
                    }
                } else{
                    //individual
                    resolve({id: rows[0].db_id, balance: rows[0].rentBalance, name: rows[0].name});
                }
                if(!currentUser.db_id) {
                  currentUser = rows[0];
                  socket.handshake.session.currentUser = currentUser;
                  socket.handshake.session.save();
                }
            } else {
                reject(NO_USER);
            }
        });
    }

    function getBand(id, bands) {
      var returnBand;
      bands.forEach(function(band){
        if(band.id == id){
            returnBand = band;
          }
      });
      return returnBand;
    }

    function getUser(id, users) {
      var returnUser = {};
      users.forEach(function(user){
        if(user.db_id == id){
            returnUser.name = user.name;
            returnUser.email = user.email;
            returnUser.db_id = user.db_id;
          }
      });
      return returnUser;
    }

    function populateBandsOnUsers(users){
      return new Promise(function(resolve, reject) {
          sendSocketQuery('SELECT * FROM ' + tbl_bands + ' WHERE disabled=0')
          .then(function(bands){
            var promises = [];
            users.forEach(function(user){
              var usersToBandsPromise = sendSocketQuery('SELECT * FROM ' + tbl_users_to_bands + ' WHERE user_id = ?', user.db_id)
              .then(function(results) {
                  var userBands = [];
                  if(results) {
                    results.forEach(function(user_to_band){
                      userBands.push(getBand(user_to_band.band_id, bands));
                    });
                  }
                  user.bands = userBands;
              });
              promises.push(usersToBandsPromise);
            });
            Promise.all(promises).then(function() {
                resolve(users);
            });
          });
      });
    }

    function populateMembersOnBands(bands){
      return new Promise(function(resolve, reject) {
        if(!bands || bands.length == 0){
          resolve(bands);
        }
        sendSocketQuery('SELECT * FROM ' + tbl_users)
        .then(function(users){
            var promises = [];
              bands.forEach(function(band){
                band.members = [];
                var usersToBandsPromise = sendSocketQuery('SELECT * FROM ' + tbl_users_to_bands + ' WHERE band_id = ?', band.id)
                .then(function(results) {
                    var bandMembers = [];
                    results.forEach(function(user_to_band){
                      bandMembers.push(getUser(user_to_band.user_id, users));
                    });
                    band.members = bandMembers;
                });
                promises.push(usersToBandsPromise);
              });
            Promise.all(promises).then(function() {
                resolve(bands);
            });
        });
      });
    }

    function isAuthenticated() {
        return facebookAuthenticated || googleAuthenticated;
    }
    socket.on('getUsernames', function(data) {
        //Emit user data
        var usersPromise = sendSocketQuery('SELECT name, email FROM ' + tbl_users + ' WHERE disabled=0');
        var bandsPromise = sendSocketQuery('SELECT * FROM ' + tbl_bands + ' WHERE disabled=0')
        .then(bands => populateMembersOnBands(bands));
        Promise.join(usersPromise, bandsPromise, function(users, bands) {
            socket.emit('usernames', {users: users, bands: bands});
        });
    });
    socket.on('updateGroup', function (data) {
        //facebookMgr.generateAppAccess(data.accessToken)
        //.then(accessToken => facebookMgr.getGroupMembers(accessToken))
        //.then(function(ids, names) {
        //  sendQuery('UPDATE ' + tbl_users + ' SET disabled=1 WHERE auto_disable_enable = 1 AND fb_id NOT IN (' + ids.join() + ')', null, true);
        //  if(ids.length > 1){
        //      for (var i = 0; i < ids.length; i++) {
        //          sendQuery('INSERT INTO ' + tbl_users + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE disabled = IF(auto_disable_enable = 1, 0, VALUES(disabled))', [null, ids[i], null, names[i], null, null, null, null, null, null, null, 0, 1], true);
        //      };
        //  }
        //});
    });
    socket.on('getUsers', function (data){
      var usersPromise = sendSocketQuery('SELECT * FROM ' + tbl_users)
      .then(users => populateBandsOnUsers(users))
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
        //TODO: change paymentFrom to description
        sendSocketQuery('SELECT v.name AS verifiedBy, a.name AS assignedTo, t.date, t.amount, t.paymentFrom, t.db_id FROM ' + tbl_transactions + ' AS t LEFT JOIN ' + tbl_users + ' AS v ON v.db_id = t.verifiedBy LEFT JOIN ' + tbl_users + ' AS a ON a.db_id = t.assignedTo WHERE t.date < ? OR t.verifiedBy IS NULL ORDER BY t.date DESC', moment()-5000)
        .then(transactions => socket.emit('transactions', {transactions: transactions}));
    });
    socket.on('verifyTransaction', function (data) {
        sendSocketQuery('UPDATE ' + tbl_transactions + ' SET verifiedBy = ?, assignedTo = ? WHERE db_id = ?', [data.verifiedBy, data.assignedTo, data.id]);
        sendSocketQuery('UPDATE ' + tbl_users + ' SET rentBalance = rentBalance + ? WHERE db_id = ?', [data.amount, data.assignedTo]);
    });
    socket.on('newTransaction', function (data) {
        //TODO: insert object
        sendSocketQuery('INSERT INTO ' + tbl_transactions + ' VALUES (?, ?, ?, ?, ?, ?, ?)', [null, null, data.paymentTo, data.paymentFromName, data.amount, data.verifiedBy, moment().unix()]);
        sendSocketQuery('UPDATE ' + tbl_users + ' SET rentBalance = rentBalance - ? WHERE db_id = ?', [data.amount, data.paymentFrom]);
        sendSocketQuery('UPDATE ' + tbl_users + ' SET rentBalance = rentBalance + ? WHERE db_id = ?', [data.amount, data.paymentTo]);
    });
});
http.listen(calendarPort, function(){
  console.log("Listening on port " + calendarPort);
});

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

function getCurrentTime(){
    var today = new Date();
    var year = today.getFullYear();
    var month = today.getMonth()+1;
    var day = today.getDate();
    return year + "-" + (month < 10 ? "0" : "") + month + "-" + day;
}

function updateUserRentBalance(db_id, amount) {
    sendQuery("UPDATE " + tbl_users + " SET rentBalance = rentBalance + ? WHERE db_id = ?", [amount, db_id], true);
}

function createTransaction(user, name, transactionId, amount, date){
    var insertQuery = "INSERT INTO " + tbl_transactions + " VALUES (?, ?, ?, ?, ?, ?, ?)";
    if(user) {
        sendQuery(insertQuery, [null, transactionId, user.db_id, name, amount, 1, moment(date).unix()], true)
        .then(result => updateUserRentBalance(user.db_id, amount));
    } else if(amount < 0) {
        console.log("createTransaction for unregistered user")
        //TODO: create transaction to unregistered user
        //sendQuery(insertQuery, [null, id, null, name, amount, 1, moment(date).unix()], true)
        //.then(result => updateUserRentBalance(rows, rows[0].db_id, amount));
    } else {
        sendQuery(insertQuery, [null, transactionId, null, name, amount, null, moment(date).unix()], true);
    }
}

function parseTransactions(allTransactions, currentTime){
    console.log("Parsing");
    if(allTransactions != null){
        for (var i = 0; i < allTransactions.length; i++) {
            if(allTransactions[i].AccountId == 295036){
                var nameIndex = 0;
                if(allTransactions[i].Text.indexOf(":") > 0){
                    nameIndex = allTransactions[i].Text.indexOf(" ") + 1;
                }
                let name = allTransactions[i].Text.substring(nameIndex);
                let amount = allTransactions[i].Amount;
                let transactionId = allTransactions[i].Id;
                let date = allTransactions[i].Date;
                sendQuery("SELECT db_id FROM " + tbl_users + " WHERE name = ?", name, true)
                .then(users => createTransaction(users[0], name, transactionId, amount, date));
            }
        };
    }
    console.log("Parsing done, parsed " + allTransactions.length + " transactions");
    sendQuery("UPDATE " + tbl_meniga + " SET date = ? WHERE id=1", currentTime, true);
}

function getAndProcessTransactions(rows, currentTime){
  var lastUpdateMoment = moment(rows[0].date, "YYYY-M-D");
  var subtracted = lastUpdateMoment.subtract(2, 'days').format('YYYY-MM-DD');
  let username = "andrithorhalls@gmail.com";
  let password = "Superman12";
  let startTime = subtracted;
  let endTime = getCurrentTime();
  co(function* () {
    try {
      let menigaClient = new MenigaClient();
      let authed = yield menigaClient.auth(username, password);
      let categories = yield menigaClient.getUserCategories();
      let categoriesByIndex = _.keyBy(categories, 'Id');
      let page = 0;
      let transactions;
      let allTransactions = [];
      do {
        transactions = yield menigaClient.getTransactionsPage({
          filter: {
            PeriodFrom: moment(startTime).subtract(60, 'days'),
            PeriodTo: moment(endTime).add(1, 'days'),
          },
          page: page
        });
        _.forEach(transactions.Transactions, function (transaction) {
          if (_.has(categoriesByIndex, transaction.CategoryId)) {
            transaction.Category = categoriesByIndex[transaction.CategoryId];
          }
          allTransactions.push(transaction);
        });
        page++;
      } while (transactions.HasMorePages);
        return yield Promise.resolve(allTransactions);
    } catch (err) {
      console.error('got err:', err);
    }
  })
  .then(transactions => parseTransactions(transactions, currentTime));
};



//run once every hour
var getTransactions = schedule.scheduleJob('0 */6 * * *', function(){
    var currentTime = getCurrentTime();
    sendQuery("SELECT * FROM Meniga", currentTime, true)
    .then(rows => getAndProcessTransactions(rows, currentTime));
});
//run at midnight the first day of every month
var j = schedule.scheduleJob('0 0 1 * *', function(){
    sendQuery("SELECT id, bandName, rentBalance FROM " + tbl_bands, null, true)
    .then(function(allBands) {
      allBands.forEach(function(band) {
        if(band.rent){
          createTransaction(null, band.bandName, null, -band.rent, new Date());
          sendQuery("UPDATE " + tbl_bands + " SET rentBalance=rentBalance - rent WHERE id = ?", [band.id], true);
        }
      });
    });
    sendQuery("SELECT db_id, name, rent FROM " + tbl_users, null, true)
    .then(function(allUsers) {
      allUsers.forEach(function(user) {
        if(user.rent){
          createTransaction(user, user.name, null, -user.rent, new Date());
        }
      });
    });
});
