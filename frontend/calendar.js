import Ember from 'ember';
import config from '../../../config/environment';
import moment from 'moment';
import BusProperties from '../../../mixins/business';

export default Ember.Component.extend(
  BusProperties,
  {

  /////////////////////////////////////
  // PROPERTIES
  /////////////////////////////////////
  time: Ember.inject.service(),
  session: Ember.inject.service('session'),
  isEditing: false,
  isCancelling: false,
  currentAppointment: null,
  cachedApptIds: [],
  viewingAppointment: false,
  appointments: null,
  staffFilter: null,
  customerFilter: null,
  minLength: 0,
  params: Ember.inject.service('appointment-params'),
  store: Ember.inject.service(),
  fetchedResources: [],
  sectionTitle: 'Scheduling: Calendar',
  sectionDescription: 'Lots of magical, fantastic things',

  /////////////////////////////////////
  // INITIATORS
  /////////////////////////////////////

  // update resources when date or view is changed
  updateResourcesOnButtonClick: function() {
    const _this = this;
    Ember.$('.fc-button').on('click', function() {
      // update which resources are shown
      _this.send('filterResources');
    });

  }.on('didInsertElement'),

  /////////////////////////////////////
  // OBSERVERS
  /////////////////////////////////////

  // update filtered events and resources when filters change
  watchFilters: Ember.observer('staffFilter','customerFilter', function() {
    this.send('filterResources');
  }),

  /////////////////////////////////////
  // COMPUTED PROPERTIES
  /////////////////////////////////////

  // staffs for autocomplete
  staffs: Ember.computed('fetchedResources', function() {
    return this.get('fetchedResources');
  }),

  // format resources for calendar
  resources: Ember.computed(function() {
    const _this = this;
    return function(callback) {

      // send ajax request to fetch staffs
      Ember.$.ajax({
        url: config.APP.API_URL + '/staffs',
        data: {
          include: 'user',
          'filter[active]': 'true',
          'filter[archived]': 'false',
          'fields[staff]': 'id',
          'fields[user]': 'firstName,lastName'
        },
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: _this.get('session.data.authenticated.token')
        },

        // success callback
        success: function(doc) {

          // setup variables
          const resources = [],
                included = doc.included;
          let   userId, fullName;

          // loop through results and format each resource correctly
          _.each(doc.data, function(resource) {
            userId = resource.relationships.user.data.id;

            // format title
            included.forEach(function(user) {
              if (+user.id === +userId) {
                fullName = user.attributes.lastName +
                           ', ' +
                           user.attributes.firstName;
              }
            });

            // push to resources array
            resources.push({
              id: resource.id,
              title: fullName,
              // add name for paper-autocomplete filtering
              name: fullName
            });
          });

          // set resources so can use after
          _this.set('fetchedResources', resources.sortBy('title'));

          // return resources
          callback(resources);

          // update which resources are shown
          _this.send('filterResources');

        }
      });
    };
  }),

  // setup events json source for calendar
  events: Ember.computed(function() {

    const _this = this;
    const t = this.get('time');

    return function(start, end, timezone, callback) {
      Ember.$.ajax({
        url: config.APP.API_URL + '/appointments',
        data: {
          'filter[requestStatus]': 'approved,auto_approved',
          'fields[appointment]': 'recurrencePattern,status,scheduledStartTime,'+
                                 'scheduledEndTime,staffId,requestStatus' +
                                 ',customerId',
          start: start.toISOString(),
          end: end.toISOString()
        },
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: _this.get('session.data.authenticated.token')
        },
        success: function(doc) {
          const events = [];
          let utcStart, utcEnd, start, end, color, status;
          _.each(doc.data, function(appt) {
            utcStart = appt.attributes.scheduledStartTime;
            utcEnd = appt.attributes.scheduledEndTime;
            start = t.format(utcStart,"YYYY-MM-DD[T]HH:mm");
            end = t.format(utcEnd,"YYYY-MM-DD[T]HH:mm");
            status = appt.attributes.status;

            // set color based on status
            switch (status) {
              case 'scheduled':
                color = 'blue';
                break;
              case 'late':
                color = 'red';
                break;
              case 'completed':
                color = 'green';
                break;
              default:
                color = 'blue';
            }

            events.push({
              title: 'Appointment',
              start: start,
              end: end,
              customerId: appt.attributes.customerId,
              requestStatus: appt.attributes.requestStatus,
              recurrencePattern: appt.attributes.recurrencePattern,
              color: color,
              resourceId: appt.attributes.staffId.toString(),
              id: +appt.id
            });
          });

          callback(events);
          // update which resources are shown
          _this.send('filterResources');
        }
      });
    };
  }),

  /////////////////////////////////////
  // ACTIONS
  /////////////////////////////////////

  actions: {

    // leave calendar view
    closeCalendar() {
      this.sendAction('closeCalendar');
    },

    toggleEditView() {
      this.toggleProperty('isEditing');
    },

    toggleViewingAppointment() {
      this.toggleProperty('viewingAppointment');
    },

    // send find record request
    // and set current appointment
    findAppointmentAndOpen(appId) {
      const _this = this;

      // setup params
      let params = this.get('params').params();
      params['filter[id]'] = appId;
      // make request
      this.get('store').queryRecord('appointment', params)
        .then(function(appt) {
          // cache appointment
          _this.get('cachedApptIds').addObject(+appt.get('id'));
          // set appointment
          _this.set('currentAppointment', appt);
          // open appointment model
          _this.set('isEditing', false);
          _this.set('isCancelling', false);
          _this.set('viewingAppointment', true);
        })
        .catch(function(err) {
          alert('Oops appointment could not be retrieved. Please try again soon');
          console.log(err);
        });
    },

    // peek record from store
    // and set current appointment
    peekAppointmentAndOpen(apptId) {
      const _this = this;
      const appt = this.get('store').peekRecord('appointment', apptId);
      // set appointment
      _this.set('currentAppointment', appt);
      // open appointment model
      _this.set('isEditing', false);
      _this.set('isCancelling', false);
      _this.set('viewingAppointment', true);
    },

    openAppointment(event) {
      const apptId = event.id;
      // check if already fetched appointment
      // and set current appointment accordingly
      if (!_.includes(this.get('cachedApptIds'), apptId)) {
        this.send('findAppointmentAndOpen', apptId);
      } else {
        this.send('peekAppointmentAndOpen', apptId);
      }
    },

    removeAppt() {
      this.setProperties({
        isEditing: false,
        isCancelling: false,
        viewingAppointment: false
      });
      Ember.$('.full-calendar').fullCalendar('refetchEvents');
    },

    // filter which resources are shown or not
    // based on whether they have events or not
    filterResources() {
      const _this = this;
      let showResource,events,view,start,end;
      const calendar = Ember.$('.full-calendar');

      // filter resources
      let resourcesToShow = this.get('fetchedResources').filter(function(r) {
        showResource = false;
        events = calendar.fullCalendar('getResourceEvents', r);
        if (_.isArray(events) &&
            !_.isEmpty(events)) {

              // get viewable start and end dates
              // currently being shown in calendar
              // so can filter by those dates
              // wouldn't let me assign these outside
              // of function for some reason
              view = calendar.fullCalendar('getView');
              start = view.start;
              end = view.end;

              // if event is shown for current view, show resource
              events.forEach(function(event) {
                // if event start >= view start && <= view end ||
                //    event end >= view start && <= view end
                if (event.start.isAfter(start) && event.start.isBefore(end) ||
                    event.end.isAfter(start) && event.end.isBefore(end)) {

                  // check for customer filter
                  const customerFilter = _this.get('customerFilter');
                  if (customerFilter) {
                    if (+customerFilter.customerId === +event.customerId) {
                      showResource = true;
                    }
                  } else {
                    showResource = true;
                  }
                }
              });
        }

        if (showResource) return true;
        return false;
      });

      // filter resource by staffFilter
      if (this.get('staffFilter')) {
        resourcesToShow = resourcesToShow.filter(function(resource) {
          return +resource.id === +_this.get('staffFilter.id');
        });
      }

      // reset resources
      this.send('resetResources', resourcesToShow);
    },

    resetResources(resources) {
      const _this = this;
      const _resources = resources;
      const calendar = Ember.$('.full-calendar');

      // remove resources
      function removeResources(calendar) {
        return Promise.all(_this.get('fetchedResources').map(function(r) {
          return calendar.fullCalendar('removeResource', r);
        }));
      }

      removeResources(calendar)
      .then(function() {
        // readd filtered resources
        _resources.sortBy('title').forEach(function(r) {
          calendar.fullCalendar('addResource', r);
        });

        calendar.fullCalendar('rerenderEvents');
      })
      .catch(function(err) {
        console.log(err);
      });
    },

    // alter css of events
    eventRender(event, element) {

      // if recurring, add recurring icon
      if (event.recurrencePattern) {
        element.find('div').prepend("<i class=\"fa fa-repeat\"></i>");
      }

      // add lightning icon if auto_approved
      if (event.requestStatus === 'auto_approved') {
        element.find('div').prepend("<i class=\"fa fa-bolt\"></i>");
      }

      // if customer filter is set
      // filter by customer
      const customerFilter = this.get('customerFilter');
      if (customerFilter &&
          +customerFilter.customerId === +event.customerId) {
          element.removeClass();
          element.find('div').remove();
      }

    }
  }


});
