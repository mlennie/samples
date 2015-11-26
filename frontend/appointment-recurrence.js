import Ember from 'ember';
import apiAjax from '../../../utils/apiAjax';
import config from '../../../config/environment';
import moment from 'moment';

export default Ember.Component.extend({

  /////////////////////////////////////
  // PROPERTIES
  /////////////////////////////////////
  daysString: "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
  rruleDaysString: "MO,TU,WE,TH,FR,SA,SU",
  recurrenceIntervals: ['Weekly', 'Bi-Weekly'],


  /////////////////////////////////////
  // INITIALIZERS
  /////////////////////////////////////

  /////////////////////////////////////
  // OBSERVER
  /////////////////////////////////////

  // update recurrencePattern if any dependencies change
  watchRecurringDependencies: Ember.observer('isRecurring',
                                     'recurringEndDate',
                                     'recurringFreq',
                                     'recurringDays', function() {
    this.send('updateRecurring');
  }),

  /////////////////////////////////////
  // COMPUTED PROPERTIES
  /////////////////////////////////////

  // get recurring frequency from appointment recurrencePattern
  recurringFreq: Ember.computed('appointment.recurrencePattern', function() {

    // since rrule doesn't have bi-weekly we're using a freq of weekly with
    // an interval of 1 to be weekly and an interval of 2 to be bi weekly
    var pattern = this.get('appointment.recurrencePattern'), interval;

    // set interval to 1 (weekly) if there is no pattern yet
    if (pattern) {
      interval = RRule.parseString(pattern).interval;
    } else {
      interval = 1;
    }

    // set freq to weekly or bi-weekly based on interval
    if (interval === 1) {
      return this.get('recurrenceIntervals')[0];
    } else {
      return this.get('recurrenceIntervals')[1];
    }
  }),

  // get recurring frequency days from appointment recurrencePattern
  recurringDays: Ember.computed('appointment.recurrencePattern', function() {
    var _this = this;
    // get pattern
    var pattern = this.get('appointment.recurrencePattern');

    // return empty array if no pattern yet
    if (!pattern) {
      return [];
    } else {

      // parse days and return to select
      var parsedDays = RRule.parseString(pattern).byweekday;

      if (parsedDays) {
        return parsedDays.map(function(day) {
          return {
            id: day.weekday,
            text: _this.get('daysString').split(',')[day.weekday]
          };
        });
      } else {
        return [];
      }
    }
  }),

  // get recurring frequency end date from appointment recurrencePattern
  recurringEndDate: Ember.computed('appointment.recurrencePattern', function() {
    // get pattern
    var pattern = this.get('appointment.recurrencePattern');
    if (!pattern) {
      return null;
    } else {
      return moment(RRule.parseString(pattern).until).format();
    }
  }),

  // format daysString into a select 2 array
  daysArray: Ember.computed(function() {
    return this.get('daysString').split(',').map(function(day,i) {
      return {
        id: i,
        text: day
      };
    });
  }),

  /////////////////////////////////////
  // ACTIONS
  /////////////////////////////////////

  actions: {

    // make recurring or not
    toggleRecurring() {
      this.sendAction('toggleRecurring');
      this.send('updateRecurring');
    },

    // update appointment recurrence pattern
    updateRecurring() {
      if(this.get('isRecurring')) {
        var _this = this;

        // get frequency and declare interval
        var freq = this.get('recurringFreq'), interval;

        // get interval base on frequency
        if (freq === "weekly") {
          interval = 1;
        } else if (freq === "bi-weekly") {
          interval = 2;
        }

        // get start and end dates
        var startDate = moment(this.get('appointment.scheduledStartTime')).toDate();
        var endDate = this.get('recurringEndDate');

        // setup basic rule object
        var ruleObject = {
          freq: RRule.WEEKLY,
          interval: interval,
          dtstart: startDate
        };

        // add until date
        if (!_.isNull(endDate)) {
          ruleObject.until = moment(endDate).toDate();
        }
        // get weekdays in rrule format
        var ruleDay;
        var daysArray = this.get('recurringDays').map(function(day) {
          ruleDay = _this.get('rruleDaysString').split(',')[day.id];
          return RRule[ruleDay];
       });

        // add weekdays to rrule
        ruleObject.byweekday = daysArray;

        // create and save rule
        var rule = new RRule(ruleObject).toString();
        this.get('appointment').set('recurrencePattern', rule);
      } else {
        if(!_.isUndefined(this.get('appointment'))) {
          this.get('appointment').set('recurrencePattern', null);
        }
      }
    }

  }
});
