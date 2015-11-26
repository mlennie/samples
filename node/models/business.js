const _ = require('lodash'),
  bcrypt = require('bcrypt'),
  config = require('config'),
  moment = require('moment-timezone'),
  scopes = require('../utils/auth/scopes'),
  Boom = require('boom'),
  swearjar = require('swearjar'),
  Bookshelf = require('../config/bookshelf'),
  BaseModel = require('./base'),
  Joi = require('joi'),
  Promise = require('bluebird');

// load models
require('./user');
require('./staff');
require('./service');
require('./surcharge');
require('./business_preference');
require('./appointment');

// promisify bcrypt
Promise.promisifyAll(bcrypt);

const Business = BaseModel.extend({

  tableName: 'business',

  /////////////////////////////////////
  // VALIDATIONS
  /////////////////////////////////////

  schema: Joi.object().keys({
    active: Joi.boolean(),
    address: Joi.object(),
    archived: Joi.boolean(),
    availability: Joi.object(),
    bankInformation: Joi.object(),
    createdAt: Joi.allow(),
    email: Joi.string(),
    hasSetup: Joi.boolean(),
    id: Joi.number().integer(),
    legalBusinessName: Joi.string(),
    name: Joi.string(),
    phoneNumber: Joi.string(),
    primaryContact: Joi.object(),
    subdomain: Joi.string(),
    timezone: Joi.string(),
    tin: Joi.string(),
    updatedAt: Joi.allow(),
    website: Joi.string()
  }),

  //////////////////////////////////////
  // ASSOCIATIONS
  //////////////////////////////////////

  // hasMany staffs
  staffs: function() {
    return this.hasMany('Staff');
  },

  // belongsToMany users through staffs
  users: function() {
    return this.belongsToMany('User').through('Staff');
  },

  // hasOne businessPreference
  businessPreference: function() {
    return this.hasOne('BusinessPreference');
  },

  // hasMany services
  services: function() {
    return this.hasMany('Service');
  },

  // hasMany surcharges
  surcharges: function() {
    return this.hasMany('Surcharge');
  },

  // hasMany appointments
  appointments: function() {
    return this.hasMany('Appointment');
  }

}, {

  ///////////////////////////////////////
  // CLASS METHODS
  ///////////////////////////////////////


  createBusiness: (newBusiness, newUser) => {

    // load model references
    const User = Bookshelf.model('User'),
      Staff = Bookshelf.model('Staff'),
      Business = Bookshelf.model('Business'),
      BusinessPreference = Bookshelf.model('BusinessPreference');

      // add availability to business
      newBusiness.availability = {
        hoursOfOperation: {
          monday: [
            [480, 1080]
          ],
          tuesday: [
            [480, 1080]
          ],
          wednesday: [
            [480, 1080]
          ],
          thursday: [
            [480, 1080]
          ],
          friday: [
            [480, 1080]
          ],
          saturday: [],
          sunday: [],
          exceptions: []
        },
        observedHolidays: []
      };

    // begin transaction
    return Bookshelf.transaction((t) => {

      // create new business and user in parallel and
      // then create new staff account
      return Promise.join(
        User.create(newUser, null, t),
        Business.create(newBusiness, null, t),
        (user, business) => {

          const businessId = business.get('id');

          // setup the staff account
          const newStaff = {
            userId: user.get('id'),
            businessId: businessId,
            scopes: [
              scopes.owner(), scopes.owner(businessId)
            ]
          };

          const newBusinessPreference = {
            businessId: businessId
          };

          return Promise.join(
            BusinessPreference.create(newBusinessPreference, t),
            Staff.create(newStaff, t),
            (businessPreferences, staff) => {
              return staff.get('id');
            });

          }); // end join

    }); // end transaction

  },

  /**
   * Determines if the specified subdomain is valid. Validity means that
   * the subdomain hasn't been previously reserved, isn't a system-reserved
   * subdomain and does not contain any inappropriate language.
   * @param  {[type]} subdomain [description]
   * @return {[type]}           [description]
   */
  validateSubdomain: (subdomain) => {
    // get model reference
    const Business = Bookshelf.model('Business');

    // check to see if the domain has been reserved
    if (_.includes(config.get('subdomains.reserved'), subdomain)) {
      return Promise.resolve('Subdomain has already been reserved.');
      // check to see if the subomain contains offensive language :)
    } else if (swearjar.profane(subdomain)) {
      return Promise.resolve('Prohibited language in subdomain.');
    }

    // return the least number of columns possible and don't throw an Error
    // if the record isn't found
    const options = {
      columns: ['id'],
      require: false
    };

    return Business.findOne({
        subdomain: subdomain
      }, options)
      .then((subdomain) => {
        if (_.isEmpty(subdomain)) {
          return Promise.resolve();
        } else {
          return Promise.resolve('Subdomain has already been reserved.');
        }
      });

  },

  setup: (business, staff,
    businessPreferences, services, surcharges) => {

    const BusinessPreference = Bookshelf.model('BusinessPreference'),
          Service = Bookshelf.model('Service'),
          Surcharge = Bookshelf.model('Surcharge');

    return Bookshelf.transaction((t) => {

      let updates = [];

      // only run updates where needed based on the payload
      if (!_.isEmpty(business)) {
        updates.push(Business.update(business, null, null, t));
      }
      if (!_.isEmpty(businessPreferences)) {
        updates.push(BusinessPreference.update(businessPreferences, null, null, t));
      }
      if (!_.isEmpty(services)) {
        updates.push(Service.createOrUpdate(services, { editOnly: true }, t));
      }
      if (!_.isEmpty(surcharges)) {
        updates.push(Surcharge.createOrUpdate(surcharges, { editOnly: true }, t));
      }

      return Promise.all(updates);
    });
  },

  // cross check appointment start and end times against
  // business opening hours, exceptions and holidays
  checkBusinessDates(start,end,busId) {
    const _this = this;
    return new Promise(function(resolve, reject) {

      // get business
      _this.where('id', busId).fetch()
      .then(function(business) {

        // prepare needed information
        const avail = business.get('availability'),
              timezone = business.get('timezone'),
              dayOfWeek = moment(start).format("dddd").toLowerCase(),
              dayHours = avail.hoursOfOperation[dayOfWeek],
              closedMessage = 'Business is not open during requested time',
              closedMessageError = Boom.badRequest(closedMessage),
              localStart = moment.tz(start,timezone).format();
        let withinOpeningHours = false, open, close, requestedStartTime;

        /************************
         * STEP 1: Check Dates
         ************************/

        // if business is open that day look at hours
        if (dayHours.length > 0) {

          /************************
           * STEP 2: Check Times
           ************************/

          dayHours.forEach(function(interval) {
            open = +interval[0];
            close = +interval[1];
            requestedStartTime = moment.duration(localStart).asMinutes();

            // loop opening hour intervals and and see if there is a match
            // with the requested time
            if (requestedStartTime >= open &&
                requestedStartTime < close) {
              withinOpeningHours = true;
            }
          });

          if (!withinOpeningHours) return reject(closedMessageError);
        } else {
          return reject(closedMessageError);
        }


        /****************************
         * STEP 3: Check Exceptions
         ****************************/
        const exceptions = avail.hoursOfOperation.exceptions;
        const localStartDay = moment.tz(localStart,timezone)
                                    .format("YYYY-MM-DD");
        let localException;

        // if requested start time matches an exception (day off)
        // set withinOpeningHours to false and reject with error
        exceptions.forEach(function(exception) {
          localException = moment(exception).format("YYYY-MM-DD");
          if (localStartDay === localException) withinOpeningHours = false;
        })

        if (!withinOpeningHours) return reject(closedMessageError)

        return resolve();

      })
      .catch(function(err) {
        return reject(err);
      })
    });
  }
});

module.exports = Bookshelf.model('Business', Business);
