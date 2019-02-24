var socket = io.connect("https://starmyri.ga");
var currentUser = {};
var users = [];
//TODO: implement better id management;
var nextFreeId = 1;
var MILLISECONDS_IN_MINUTE = 60000;
var MINUTES_IN_DAY = 1440;
var daysToShow = readCookie("daysToShow") == null?Math.round(window.innerWidth/220):parseInt(readCookie("daysToShow"));
var timeslotHeight = readCookie("timeslotHeight") == null?(mobile?30:15):parseInt(readCookie("timeslotHeight"));
var mobile = false;
if (typeof window.orientation !== 'undefined') { mobile = true; }
var magicConfigTitle = {
                     data: users,
                     typeDelay: 10,
                     maxSelection: 1,
                     maxDropHeight: 100,
                     maxSelectionRenderer: function(){ return ''; },
                     required: true,
                     placeholder: "Select or enter title",
                     noSuggestionText: "5000/7500 kr per æfingu",
                     strictSuggest: true,
                     useZebraStyle: true
                  };
function signOut(){
  socket.emit('signOut');
  window.setTimeout(location.reload(), 5000);
}
function createCookie(name,value) {
    if (typeof(Storage) !== "undefined") {
        localStorage.setItem(name, value);
    } else {
        console.log("No localStorage detected");
    }
}

function readCookie(name) {
    if (typeof(Storage) !== "undefined") {
        return localStorage.getItem(name);
    } else {
        console.log("No localStorage detected");
        return null;
    }
}

var recurringIsVisible = false;
function setRecurringVisibility(value){
    if(value){
        $j("#switch-week-or-picker").show();
        $j("#recurringOptions").slideDown();
        recurringIsVisible = true;
        $("#recurringOptionsButton").html("Cancel repeat");
    } else {
        $j("#recurringOptions").slideUp( "default", function() {
            //animation complete
            $("#recurringOptions").hide();
        });
        $j("#switch-week-or-picker").hide();
        recurringIsVisible = false;
        $("#recurringOptionsButton").html("Repeat");
    }
}
var weeklineIsVisible = false;
function setWeekLineVisibility(value){
    if(value){
        $j("#switch-week-or-picker").html("Pick days");
        $j("#week-series").slideDown();
        $j("#days-series").slideUp();
        weeklineIsVisible = true;
    } else {
        $j("#switch-week-or-picker").html("Weekly");
        $j("#week-series").slideUp();
        $j("#days-series").slideDown();
        weeklineIsVisible = false;
    }
}
var editAll = false;
var $calendar;
function resetForm($dialogContent) {
   $dialogContent.find("input").val("");
   $dialogContent.find("textarea").val("");
   $dialogContent.find("label[name='errorMsg']").empty();
   $dialogContent.find("#room-select").val("R");
   $j('#weekline').weekLine("setSelected", "");
   setRecurringVisibility(false);
   $("#recurringOptionsButton").html("Repeat");
   $("#recurringOptionsButton").show();
   $("#editAllOptions").hide();
   $j('#editAllCheckbox').prop('checked', false);
   $("#creatorWrapper").hide();
   $("#creator").html("");
   editAll = false;
   attendeeEmails = [];
}

var settingsOpen = false;
function toggleSettings() {
    if(settingsOpen){
        $("#side-menu").animate({
            left: '-25em'
        }, 500);
        $("#burger-menu").animate({
            left: '0'
        }, 300);
        $("#overlay").fadeOut();
        settingsOpen = false;
    } else {
        $("#side-menu").animate({
            left: '0'
        }, 500);
        $("#burger-menu").animate({
            left: '10em'
        }, 600);
        $("#overlay").fadeIn();
        settingsOpen = true;
    }
    $(this).toggleClass('open');
}

function setDaysToShow(){
    var value = $("#daysToShow-input").val();
    createCookie("daysToShow", value);
    $('#calendar').weekCalendar("setDaysToShow", value);
    ga('send', {
      hitType: 'event',
      eventCategory: 'Settings',
      eventAction: 'daysToShow',
      eventLabel: value
    });
}

function setTimeslotHeight(){
    var value = $("#timeslotHeight-input").val();
    createCookie("timeslotHeight", value);
    $('#calendar').weekCalendar("setTimeslotHeight", value);
    ga('send', {
      hitType: 'event',
      eventCategory: 'Settings',
      eventAction: 'timeslotHeight',
      eventLabel: value
    });
}

$(document).ready(function() {
    $('*').blur();
    $('#burger-menu').click(toggleSettings);
    $j('.ms-trigger-ico').on("tap",function(){
      return false;
    });
    $('#daysToShow-input').val(daysToShow);
    $('#timeslotHeight-input').val(timeslotHeight);
    $j('#weekline').weekLine();
    $j("#weekline").removeClass("weekDays-dark");
    $j("#multi-datepicker").datepicker();
    var multiDatePicker = $j('#multi-datepicker').datepicker().data('datepicker');
    $('#editAllCheckbox').click(function() {
        editAll = this.checked;
    });

   function addEvent(calEvent){
       calEvent.start = new Date(calEvent.start*1000);
       calEvent.end = new Date(calEvent.end*1000);
       calEvent.body = calEvent.body;
       calEvent.title = calEvent.title;
       var endDay = new Date(calEvent.end.getFullYear(), calEvent.end.getMonth(), calEvent.end.getDate(), overflowHours, 0);
       if(calEvent.end.getHours() <= overflowHours){
           endDay.setDate(endDay.getDate()-1);
       }

       if(endDay.getTime() < calEvent.end.getTime() && endDay.getTime() > calEvent.start.getTime()){
           ga('send', {
             hitType: 'event',
             eventCategory: 'Events',
             eventAction: 'eventOverlapsGrid'
           });
           //Event overlaps calendar, so we need to split it
           var events = [];
           var ids = [];
           calEvent.realId = calEvent.id;
           calEvent.realStart = new Date(calEvent.start);
           calEvent.realEnd = new Date(calEvent.end);
           calEvent.end = new Date(calEvent.start);
           //TODO: set to start time
           calEvent.end.setHours(6);
           calEvent.end.setMinutes(0);
           if(calEvent.start.getHours() >= overflowHours){
               calEvent.end.setDate(calEvent.end.getDate()+1);
            }
            ids.push(nextFreeId);
            calEvent.id=nextFreeId++;
            events.push(Object.assign({}, calEvent));
            calEvent.start = new Date(calEvent.end);
            calEvent.end = new Date(calEvent.end);
            calEvent.end.setDate(calEvent.end.getDate()+1);
           while(calEvent.realEnd > calEvent.end){
               ids.push(nextFreeId);
               calEvent.id=nextFreeId++;
               events.push(Object.assign({}, calEvent));
               calEvent.start = new Date(calEvent.end);
               calEvent.end = new Date(calEvent.end)
               calEvent.end.setDate(calEvent.end.getDate()+1);
           }
           calEvent.end = calEvent.realEnd;
           ids.push(nextFreeId);
           calEvent.id=nextFreeId++;
           events.push(Object.assign({}, calEvent));
           events.forEach(function(calEvent) {
               calEvent.siblingsIds = ids;
                $calendar.weekCalendar("updateEvent", calEvent);
            });
       } else {
    	  $calendar.weekCalendar("updateEvent", calEvent);
      }
}
   function editEvent(calEvent){
      calEvent.start = new Date(calEvent.start*1000);
      calEvent.end = new Date(calEvent.end*1000);
      calEvent.body += "\rEdited by: " + name;
      $calendar.weekCalendar("updateEvent", calEvent);
   }

   socket.on('warning', function(data){
       console.log("warning");
       console.log(data);
   });

   socket.on('userData', function(data) {
     var user = data.user;
     if(user){
			if(user.rentBalance < 0)
			   $('.rentBalance').html('<p class="balanceAmountRed">'  + user.name + " <br>" + user.rentBalance + " kr. </p>");
			else if(user.rentBalance > 0)
			   $('.rentBalance').html('<p class="balanceAmountGreen">' + user.name + " <br>+" + user.rentBalance + " kr. </p>");
			else if(user.rentBalance == 0)
			   $('.rentBalance').html('<p class="balanceAmountGreen">' + user.name + " <br>" + user.rentBalance + " kr. </p>");
			 currentUser = user;
		   if(currentUser.name == "Starmýri"){
		       setInterval(function() {
		           $('#calendar').weekCalendar("refresh");
		           $('#calendar').weekCalendar("scrollToCurrentHour");
		        }, 300000);
		    }
      }
      if(data.users && data.bands) {
        var i = 0;
        for (i; i < data.bands.length; i++) {
           users[i] = {id: i, name: data.bands[i].bandName, members: data.bands[i].members};
        };
        for (var j = 0; j < data.users.length; j++) {
           if(data.users[j].name != "Tilraun Gaman"){
              users[i] = {id: i, name: data.users[j].name, email: data.users[j].email};
              i++;
           }
        };
      }
 });

   socket.on('events', function (data) {
       if(data.events) {
          for (var i = 0; i < data.events.length; i++) {
             addEvent(data.events[i]);
          };
      }
   });
   socket.on('refresh', function(data) {
       $('#calendar').weekCalendar("refresh");
   });
   socket.on('editEvent', function (data) {
      editEvent(data.events);
   });
   socket.on('deleteEvent', function (data) {
       var id = data.events;
      $calendar.weekCalendar("removeEvent", id);
   });
   $calendar = $('#calendar');
   var day = new Date();
   var dayOfWeek = day.getDay(); // Current day of week
   var overflowHours = 6; // Hours after midnight
   var deleteFromDatabase = function(id) {
      if(id != undefined)
        socket.emit('deleteEvent', {id: id});
   }
   var deleteSeriesFromDatabase = function(series) {
      if(series != undefined)
        socket.emit('deleteSeries', {series: series});
   }

   var getArrayFromPicker = function(picker){
       var timeArray = picker.get().split(":");
       timeArray[0] = parseInt(timeArray[0]);
       timeArray[1] = parseInt(timeArray[1]);
       return timeArray;
   }

   var setMinimumForEndPicker = function(startDate, endDate){
       if(isNaN( startDate.getTime()) || isNaN( endDate.getTime()))
            return;
       if(getMidNight(startDate).getTime() >= getMidNight(endDate).getTime()){
           var startTimeArray = getArrayFromPicker(startTimePicker);
           startTimeArray[1] += 15;
           endTimePicker.set('min', startTimeArray);
           var endTimeArray = getArrayFromPicker(endTimePicker);
           if(startTimeArray[0] >= endTimeArray[0] || (startTimeArray[0] == endTimeArray[0] && startTimeArray[1] > endTimeArray[1]))
               endTimePicker.set('select', startTimeArray);
        } else
            endTimePicker.set('min', [0,0]);
   }

   var saveToDatabase = function(calEvent, charge) {
      calEvent.start = calEvent.start.getTime()/1000;
      calEvent.end = calEvent.end.getTime()/1000;
      calEvent.creator = currentUser.name;
      if(calEvent.seriesStart && calEvent.seriesEnd)
        socket.emit('saveRecurringEventWithSeries', {recurringEvent: calEvent, charge: charge});
      else if(calEvent.recurringDates)
        socket.emit('saveRecurringEventWithDates', {recurringEvent: calEvent, charge: charge});
      else
        socket.emit('saveEvent', {events: calEvent, charge: charge});
   };
   var updateDatabase = function(calEvent, charge) {
      calEvent.start = calEvent.start.getTime()/1000;
      calEvent.end = calEvent.end.getTime()/1000;
      calEvent.creator = name;
      socket.emit('editEvent', {events: calEvent, charge: charge});
   };
   var updateRecurringInDatabase = function(data) {
       data.startChange/=1000;
       data.endChange/=1000;
       socket.emit('editRecurringEvent', data);
   };

   var $calendarDateInput = $j('#calendar-datepicker').pickadate({
       formatSubmit: 'yyyy/mm/dd',
       format: 'd. mmm',
       hiddenName: true,
       onSet: function(context) {
           if(context.select != null){
               $('#calendar').weekCalendar("gotoWeek", new Date(context.select));
           }
       }
   });
   var calendarDatePicker = $calendarDateInput.pickadate('picker');
   $j('#calendar-datepicker').off('focus')


   var $endDateInput = $j('#end-datepicker').pickadate({
       formatSubmit: 'yyyy/mm/dd',
       format: 'd. mmm',
       hiddenName: true,
       onSet: function(context) {
           var endDate = new Date(context.select);
           var startDate = new Date(startDatePicker.get('select', 'yyyy/mm/dd'));
           setMinimumForEndPicker(startDate, endDate);
       }
   });
   var endDatePicker = $endDateInput.pickadate('picker');

   var $endTimeInput = $j( '#end-timepicker' ).pickatime({
       interval: 15,
       format: 'HH:i',
       max: [23,59]
   });
   var endTimePicker = $endTimeInput.pickatime('picker');

   var $startDateInput = $j('#start-datepicker').pickadate({
       formatSubmit: 'yyyy/mm/dd',
       format: 'd. mmm',
       hiddenName: true,
       onSet: function(context) {
          var startDate = new Date(context.select);
          var endDate = new Date(endDatePicker.get('select', 'yyyy/mm/dd'));
          if(!isNaN(endDate.getTime()) && startDate.getTime() > endDate.getTime())
              endDatePicker.set('select', startDate);
          endDatePicker.set('enable', true);
          endDatePicker.set('disable', [
              { from: new Date(1970,1,1), to: new Date(context.select - MINUTES_IN_DAY * MILLISECONDS_IN_MINUTE) }
          ]);

          setMinimumForEndPicker(startDate, endDate);
      }
   });
   var startDatePicker = $startDateInput.pickadate('picker');

   var $startTimeInput = $j( '#start-timepicker' ).pickatime({
       //TODO: CONFIG VALUES
       format: 'HH:i',
       min: [00,00],
       max: [23,59],
       interval: 15,
       onSet: function(context) {
           var startDate = new Date(startDatePicker.get('select', 'yyyy/mm/dd'));
           var endDate = new Date(endDatePicker.get('select', 'yyyy/mm/dd'));
           setMinimumForEndPicker(startDate, endDate);
       }
  });

  var startTimePicker = $startTimeInput.pickatime('picker');


  var $seriesEndDateInput = $j('#series-end-datepicker').pickadate({
      formatSubmit: 'yyyy/mm/dd',
      format: 'd. mmm',
      hiddenName: true
  });
  var seriesEndDatePicker = $seriesEndDateInput.pickadate('picker');

  var $seriesStartDateInput = $j('#series-start-datepicker').pickadate({
      formatSubmit: 'yyyy/mm/dd',
      format: 'd. mmm',
      hiddenName: true,
      onSet: function(context) {
          seriesEndDatePicker.set('disable', [
             { from: [0,0,0], to: new Date(context.select - MINUTES_IN_DAY * MILLISECONDS_IN_MINUTE) }
         ]);
     }
  });
  var seriesStartDatePicker = $seriesStartDateInput.pickadate('picker');

  var getDateFromPickers = function(datePicker, timePicker) {
      var date = new Date(datePicker.get('select', 'yyyy/mm/dd'));
      if(timePicker) {
          var timeArray = getArrayFromPicker(timePicker);
          date.setHours(parseInt(timeArray[0]));
          date.setMinutes(parseInt(timeArray[1]));
      }
      return date;
  }

  var getMidNight = function(event){
      return new Date(event.getFullYear(),
                              event.getMonth(),
                              event.getDate(),
                              0,0,0);
  }

  var populateAttendeeEmails = function(e,m){
    attendeeEmails = [];
     if(users[this.getValue()]) {
       var selectedUser = users[this.getValue()];
       if(selectedUser.members) {
         selectedUser.members.forEach(function(member){
           if(member.email){
            attendeeEmails.push(member.email);
          }
         });
       } else if(selectedUser.email){
         attendeeEmails.push(selectedUser.email);
       }
     }
   }

  var attendeeEmails = [];
   $calendar.weekCalendar({
      timeslotsPerHour : 4,
      allowCalEventOverlap : true,
      overlapEventsSeparate: true,
      firstDayOfWeek : dayOfWeek - 1,
      businessHours :{start: overflowHours, end: 24 + overflowHours, limitDisplay: true },
      daysToShow : daysToShow,
      overflowHours: overflowHours,
      scrollToCurrentHourSubtract: 2,
      timeslotHeight: timeslotHeight,

      height : function($calendar) {
         return $(window).height() - $("h1").outerHeight() - 1;
      },
      eventRender : function(calEvent, $event) {
         if (calEvent.end.getTime() < new Date().getTime()) {
            $event.css("backgroundColor", "#aaa");
            $event.find(".wc-time").css({
               "backgroundColor" : "#999",
               "border" : "1px solid #888"
            });
         }
         else if (calEvent.room === "L") {
            $event.css("backgroundColor", "#B65700");
            $event.find(".wc-time").css({
               "backgroundColor" : "#5A2B00",
               "border" : "1px solid #64310C"
            });
         }
         else if (calEvent.room === "R") {
            $event.css("backgroundColor", "#009200");
            $event.find(".wc-time").css({
               "backgroundColor" : "#004800",
               "border" : "1px solid #004A00"
            });
         }
         else if (calEvent.room === "B") {
            $event.css("backgroundColor", "#B60000");
            $event.find(".wc-time").css({
               "backgroundColor" : "#5A0000",
               "border" : "1px solid #640C0C"
            });
         }
      },
      draggable : function(calEvent, $event) {
         return calEvent.readOnly != true && calEvent.realId == null;
      },
      resizable : function(calEvent, $event) {
         return calEvent.readOnly != true && calEvent.realId == null;
      },
      eventNew : function(calEvent, $event) {
          ga('send', {
            hitType: 'event',
            eventCategory: 'Events',
            eventAction: 'newEvent - click'
          });
         var $dialogContent = $("#event_edit_container");
         resetForm($dialogContent);
         if(calEvent){
             startDatePicker.set('select', calEvent.start);
             endDatePicker.set('select', calEvent.end);
             var midNightStart = getMidNight(calEvent.start);
             var midNightEnd = getMidNight(calEvent.end);
             startTimePicker.set('select', (calEvent.start.getTime() - midNightStart.getTime()) / MILLISECONDS_IN_MINUTE);
             endTimePicker.set('select', (calEvent.end.getTime() - midNightEnd.getTime()) / MILLISECONDS_IN_MINUTE);
         } else calEvent = {};
         var bodyField = $dialogContent.find("textarea[name='body']");
         var roomField = $dialogContent.find("select[name='room']");
         var msgField = $dialogContent.find("label[name='errorMsg']");
         var titleField = $j('#title').magicSuggest(magicConfigTitle);
         titleField.clear();
         if(currentUser.db_id != 1){
           titleField.setSelection({id: currentUser.db_id, name: currentUser.name});
         }
         $j(titleField).on('selectionchange', populateAttendeeEmails);

         $dialogContent.dialog({
            modal: true,
            title: "New Calendar Event",
            width: 500,
            open: function(event, ui) {
                $("input").blur();
		            $(".ui-dialog").focus();
            },
            close: function() {
               $dialogContent.dialog("destroy");
               $dialogContent.hide();
               $('#calendar').weekCalendar("removeUnsavedEvents");
            },
            buttons: {
               save : function() {
                  setTimeout(function(){
                      calEvent.start = getDateFromPickers(startDatePicker, startTimePicker);
                      calEvent.end = getDateFromPickers(endDatePicker, endTimePicker);

                    if(titleField.getSelection().length == 0) {
                       msgField.empty();
                       msgField.append("Title is required");
                       return;
                    }
                    if(isNaN( calEvent.start.getTime() )){
                        msgField.empty();
                        msgField.append("Please select start date");
                        return;
                    }
                    if(isNaN( calEvent.end.getTime() )){
                        msgField.empty();
                        msgField.append("Please select end date");
                        return;
                    }
                    if(calEvent.start > calEvent.end) {
                        msgField.empty();
                        msgField.append("Event cannot start after it has ended...");
                        return;
                    }

		               var charge = false;
                    for (var i = 0; i < titleField.getSelection().length; i++) {
                       if(titleField.getSelection()[i].name != null){
                          calEvent.title = titleField.getSelection()[i].name;
                          if(titleField.getSelection()[i].name == titleField.getSelection()[i].id)
                             charge = true;
                       }
                    };

                    calEvent.body = bodyField.val();
                    calEvent.room = roomField.val();

                    var eventLabel = "singleEvent";
                    if(recurringIsVisible){
                        if(weeklineIsVisible){
                            eventLabel = "weekLine";
                          calEvent.seriesStart = getDateFromPickers(seriesStartDatePicker).getTime()/1000;
                          calEvent.seriesEnd = getDateFromPickers(seriesEndDatePicker).getTime()/1000;
                          calEvent.weekDays = $j("#weekline").weekLine('getSelected', 'indexes');
                      } else {
                          eventLabel = "datePicker";
                          calEvent.recurringDates = multiDatePicker.selectedDates;
                      }
                    }
                    calEvent.attendees = attendeeEmails;

                    ga('send', {
                      hitType: 'event',
                      eventCategory: 'Events',
                      eventAction: 'newEvent',
                      eventLabel: eventLabel
                    });
                    saveToDatabase(calEvent, charge);

                    $dialogContent.dialog("close");
                  }, 200);
               },
               cancel : function() {
                  $dialogContent.dialog("close");
               }
            }
         }).show();
      },
      eventDrop : function(calEvent, $event) {
         updateDatabase(calEvent);
         $calendar.weekCalendar("updateEvent", calEvent);
         ga('send', {
           hitType: 'event',
           eventCategory: 'Events',
           eventAction: 'dragged',
           eventLabel: calEvent.id
         });
      },
      eventResize : function(calEvent, $event) {
         updateDatabase(calEvent);
         $calendar.weekCalendar("updateEvent", calEvent);
         ga('send', {
           hitType: 'event',
           eventCategory: 'Events',
           eventAction: 'resized',
           eventLabel: calEvent.id
         });
      },
      eventClick : function(calEvent, $event) {
          ga('send', {
            hitType: 'event',
            eventCategory: 'Events',
            eventAction: 'clicked',
            eventLabel: calEvent.id
          });
         if (calEvent.readOnly) {
            return;
         }
         var $dialogContent = $("#event_edit_container");
         resetForm($dialogContent);
         var oldEvent = Object.assign({}, calEvent);
         $("#recurringOptionsButton").hide();
         if(calEvent.series != null){
            $("#editAllOptions").show();
        }
         calEvent.start = calEvent.realStart ? calEvent.realStart : calEvent.start;
         calEvent.end = calEvent.realEnd ? calEvent.realEnd : calEvent.end;
         startDatePicker.set('select', calEvent.start);
         endDatePicker.set('select', calEvent.end);
         var midNightStart = getMidNight(calEvent.start);
         var midNightEnd = getMidNight(calEvent.end);
         startTimePicker.set('select', (calEvent.start.getTime() - midNightStart.getTime()) / MILLISECONDS_IN_MINUTE);
         endTimePicker.set('select', (calEvent.end.getTime() - midNightEnd.getTime()) / MILLISECONDS_IN_MINUTE);

         var bodyField = $dialogContent.find("textarea[name='body']");
         bodyField.val(calEvent.body);
         var roomField = $dialogContent.find("select[name='room']").val(calEvent.room);
         var msgField = $dialogContent.find("label[name='errorMsg']");
         var creatorField = $dialogContent.find("div[id='creator']");
         creatorField.html(calEvent.creator);
         $("#creatorWrapper").show();
         var titleField = $j('#title').magicSuggest(magicConfigTitle);
         titleField.clear();
         $j(titleField).on('selectionchange', populateAttendeeEmails);
         titleFieldPopulated = false;
         for (var i = 0; i < users.length; i++) {
            if(users[i].name == calEvent.title){
               titleField.setValue([i]);
               titleFieldPopulated = true;
            }
         };
         if(!titleFieldPopulated)
            titleField.setSelection([{name: calEvent.title, id: calEvent.title}]);

         $dialogContent.dialog({
            modal: true,
            title: "Edit - " + calEvent.title,
            width: 500,
            open: function(event, ui) {
                $("input").blur();
		$(".ui-dialog").focus();
            },
            close: function() {
               $dialogContent.dialog("destroy");
               $dialogContent.hide();
               $('#calendar').weekCalendar("removeUnsavedEvents");
            },
            buttons: {
               save : function() {
                  setTimeout(function(){
                      calEvent.start = getDateFromPickers(startDatePicker, startTimePicker);
                      calEvent.end = getDateFromPickers(endDatePicker, endTimePicker);
                     if(calEvent.start < calEvent.end) {
                        if(titleField.getSelection().length == 0) {
                           msgField.empty();
                           msgField.append("Title is required");
                           return;
                        }
                        var charge = false;
                        for (var i = 0; i < titleField.getSelection().length; i++) {
                           if(titleField.getSelection()[i].name != null){
                              calEvent.title = titleField.getSelection()[i].name;
                              if(titleField.getSelection()[i].name == titleField.getSelection()[i].id)
                                 charge = true;
                           }
                        };
                        calEvent.body = bodyField.val();
			            calEvent.room = roomField.val();

                        if(calEvent.realId){
                            calEvent.id = realId;
                            calEvent.siblingsIds.forEach(function(id) {
                                $calendar.weekCalendar("removeEvent", id);
                            });
                        }

                        //TODO: attendees?

                        if(editAll){
                            var data = {};
                            data.startChange = calEvent.start - oldEvent.start;
                            data.endChange = calEvent.end - oldEvent.end;
                            data.title = calEvent.title;
                            data.body = calEvent.body;
                            data.room = calEvent.room;
                            data.series = calEvent.series;
                            ga('send', {
                              hitType: 'event',
                              eventCategory: 'Events',
                              eventAction: 'updateRecurringEvent',
                              eventLabel: calEvent.id
                            });
                            updateRecurringInDatabase(data);
                        } else {
                            ga('send', {
                              hitType: 'event',
                              eventCategory: 'Events',
                              eventAction: 'updateEvent',
                              eventLabel: calEvent.id
                            });
                            updateDatabase(calEvent, charge);
                        }
                        $dialogContent.dialog("close");
                     } else {
                        msgField.empty();
                        msgField.append("Event cannot start after it has ended...");
                     }
                  }, 200);
               },
               "delete" : function() {
                  if(calEvent.realId){
                      deleteFromDatabase(calEvent.realId);
                      calEvent.siblingsIds.forEach(function(id) {
                          $calendar.weekCalendar("removeEvent", id);
                      });
                  } else if(editAll){
                      ga('send', {
                        hitType: 'event',
                        eventCategory: 'Events',
                        eventAction: 'deleteRecurringEvent',
                        eventLabel: calEvent.id
                      });
                      deleteSeriesFromDatabase(calEvent.series);
                  } else {
                      ga('send', {
                        hitType: 'event',
                        eventCategory: 'Events',
                        eventAction: 'deleteEvent',
                        eventLabel: calEvent.id
                      });
                      deleteFromDatabase(calEvent.id);
                  }
                  $dialogContent.dialog("close");
               },
               cancel : function() {
                  $dialogContent.dialog("close");
               }
            }
         }).show();

         var startField = $dialogContent.find("select[name='start']").val(calEvent.start);
         var endField = $dialogContent.find("select[name='end']").val(calEvent.end);
         $(window).resize().resize(); //fixes a bug in modal overlay size ??

      },
      eventMouseover : function(calEvent, $event) {
      },
      eventMouseout : function(calEvent, $event) {
      },
      noEvents : function() {

      },
      data : function(start, end, callback) {
         callback(getEventData(start, end));
      }
   });

   function getEventData(start, end) {
      socket.emit('getAllEventsWithinTime', {start: start.getTime()/1000, end: end.getTime()/1000});
      return {events:[]};
   }
});
