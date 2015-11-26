const _ = require('lodash'),
  AppointmentPet = require('./appointment_pet'),
  AppointmentService = require('./appointment_service'),
  AppointmentSurcharge = require('./appointment_surcharge'),
  config = require('config'),
  Boom = require('boom'),
  Bookshelf = require('../config/bookshelf'),
  BaseModel = require('./base'),
  Inflection = require('inflection'),
  Joi = require('joi'),
  Promise = require('bluebird'),
  Surcharge = require('./surcharge');

// load models
require('./business');
require('./staff');
require('./customer');
require('./pet');
require('./service');
require('./surcharge');

const Appointment = BaseModel.extend({

  tableName: 'appointment',

  /////////////////////////////////////
  // VALIDATIONS
  /////////////////////////////////////

  schema: Joi.object().keys({
    id: Joi.number().integer(),
    businessId: Joi.number(),
    customerId: Joi.number().integer(),
    staffId: Joi.number().integer(),
    recurrencePattern: Joi.string().allow(null),
    recurrenceExceptions: Joi.array().items(Joi.string().isoDate()).allow(null),
    isException: Joi.boolean(),
    parentAppointmentId: Joi.number().integer().allow(null),
    requestType: Joi.string().valid([
      'new', 'cancellation', 're-approval'
    ]),
    requestStatus: Joi.string().valid([
      'pending', 'approved', 'denied', 'auto_approved'
    ]),
    status: Joi.string().allow(null).valid([
      'scheduled', 'in_progress', 'completed', 'late', 'cancelled'
    ]).allow(null),
    scheduledStartTime: Joi.string().isoDate(),
    scheduledEndTime: Joi.string().isoDate(),
    actualStartTime: Joi.string().isoDate().allow(null),
    actualEndTime: Joi.string().isoDate().allow(null),
    notes: Joi.object().allow(null),
    media: Joi.object().allow(null),
    createdBy: Joi.string().valid([
      'business', 'customer'
    ]).allow(null),
    updatedBy: Joi.string().valid([
      'business', 'staff', 'customer'
    ]),
    active: Joi.boolean(),
    archived: Joi.boolean(),
    createdAt: Joi.allow(),
    updatedAt: Joi.allow()
  }),

  //////////////////////////////////////
  // ASSOCIATIONS
  //////////////////////////////////////

  // belongsTo
  business: function() {
    return this.belongsTo('Business');
  },

  staff: function() {
    return this.belongsTo('Staff');
  },

  customer: function() {
    return this.belongsTo('Customer');
  },

  services: function() {
    return this.belongsToMany('Service');
  },

  surcharges: function() {
    return this.belongsToMany('Surcharge');
  },

  pets: function() {
    return this.belongsToMany('Pet');
  }

}, {

  ///////////////////////////////////////
  // CLASS METHODS
  ///////////////////////////////////////

  cancelAppointment: function(businessId, appointmentId, withPenalty) {

    return Bookshelf.transaction((t) => {

      const filter = {
        id: appointmentId,
        businessId: businessId
      };

      const payload = {
        requestStatus: 'approved',
        requestType: 'cancellation',
        updatedBy: 'business',
        status: 'cancelled'
      };

      // update the appointment to be "approved"
      return this.update(payload, filter, null, t)
        .then((appointment) => {

          // if the cancellation was approved with penalty, add the
          // company's active cancellation surcharge to the appointment
          if (withPenalty) {

            let surchargeFilter = {
              businessId: filter.businessId,
              surchargeType: 'cancellation',
              active: true,
              selected: true
            };

            // find the company's active cancellation charge if it exists
            return Surcharge.findOne(surchargeFilter, {
                require: true
              }, t)
              .then((surcharge) => {

                if (!surcharge) {
                  // if the surcharge could not be found, there is no cancellation surcharge active for the business
                  return Promise.reject(new Error('Cancellation Surcharge is not active. Please enable it to cancel with penalty.'));
                }

                let cancellationSurcharge = {
                  appointmentId: filter.id,
                  surchargeId: surcharge.id,
                };

                // first check to see if the surcharge has already been applied
                return AppointmentSurcharge.findOne(cancellationSurcharge, {
                    require: false
                  })
                  .then((result) => {

                    // if the surcharge has not been applied, add it
                    if (!result) {
                      return AppointmentSurcharge.create(cancellationSurcharge);
                    } else {
                      return Promise.resolve();
                    }
                  });
              })
              .then(() => {
                // finally, return the cancelled appointment
                return Promise.resolve(appointment);
              });
          }

          return Promise.resolve(appointment);
        });
    });
  },

  // cross check requested appointment times with customer availabilities
  checkCustomerDates(start,end,custId,currentApptId) {
    let _this = this;
    currentApptId = currentApptId || 0;

    return new Promise(function(resolve, reject) {
      // get all appointments for customer where start is equal or less than
      // appointment end and where end is equal or greater than appointment start 
      // Only check for appointments that don't have the current appointment id
      _this.query(function(qb) {
        qb.where('customer_id', '=', +custId)
          .andWhere('id', '!=', +currentApptId)
          .andWhere('scheduled_start_time', '<=', end)
          .andWhere('scheduled_end_time', '>=', start);
      })
      .fetch()
      .then(function(appts) {
        if (appts) {
          return reject(
            Boom.badRequest('Requested times conflict with customer\'s' +
                        ' availabilities')
          );
        } else {
          return resolve();
        }
      })
      .catch(function(err) {
        return reject(err);
      });
    });
  },

  checkDatesValidity(attributes,apptId) {
    const _this = this,
          start = attributes.scheduledStartTime,
          end = attributes.scheduledEndTime,
          busId = attributes.businessId,
          custId = attributes.customerId,
          Business = Bookshelf.model('Business');

    return new Promise(function(resolve, reject) {
      _this.checkCustomerDates(start,end,custId,apptId)
      .then(function() {
        return Business.checkBusinessDates(start,end,busId);
      })
      .then(function() {
        return resolve();
      })
      .catch(function(err) {
        return reject(err);
      });
    });

  },

  createAppointment: function(data, options) {
    const _this = this;
    return new Promise(function(resolve,reject) {
      // make sure dates are available for both customer and business
      _this.checkDatesValidity(data.attributes)

      .then(function() {
        Bookshelf.transaction((t) => {

          _this.create(data.attributes, options, t)
            .then((appointment) => {

              let transaction = {
                transacting: t
              };

              Promise.join(
                appointment.pets().attach(data.relationships.pets, t),
                appointment.services().attach(data.relationships.services, t),
                appointment.surcharges().attach(data.relationships.surcharges, t)
              ).then(() => {
                return resolve(appointment);
              });

            });
        });
      })
      .catch((err) => {
        return reject(err);
      });
    })
  },

  denyAppointment: function(businessId, appointmentId) {

    const filter = {
      id: appointmentId,
      businessId: businessId
    };

    const payload = {
      requestStatus: 'denied',
      updatedBy: 'business',
      status: null
    };

    return this.update(payload, filter);
  },

  updateAppointment: function(data, filter) {
    const _this = this;
    return new Promise(function(resolve,reject) {
      // make sure dates are available for both customer and business
      _this.checkDatesValidity(data.attributes, filter.id)

      .then(function() {

        Bookshelf.transaction((t) => {

          // retrieve the appointment with the following relations
          const relations = [
            'pets',
            'services',
            'surcharges'
          ];

          // bookshelf options to be applied
          const options = {
            transacting: t,
            require: true,
            withRelated: relations,
            patch: true,
            defaults: true
          };

          // the pets, services and surcharges to be added
          const newPets = data.relationships.pets,
            newServices = data.relationships.services,
            newSurcharges = data.relationships.surcharges;

          // find the appointment if it exists
          _this.forge(filter)
            .fetch(options)
            .then((appointment) => {

              // if the appointment exists, update it with the new data
              appointment.save(data.attributes, options)
                .then((newAppointment) => {

                  // update the pet, services and surcharges relations
                  const petRelation = newAppointment.related('pets'),
                    serviceRelation = newAppointment.related('services'),
                    surchargeRelation = newAppointment.related('surcharges');

                  const currentPets = petRelation.pluck('id'),
                    currentServices = serviceRelation.pluck('id'),
                    currentSurcharges = surchargeRelation.pluck('id');

                  // add/remove any new/orphaned pets, services and surcharges
                  Promise.join(
                    petRelation.attach(_.difference(newPets, currentPets),
                                       options),
                    petRelation.detach(_.difference(currentPets, newPets),
                                       options),
                    serviceRelation.attach(_.difference(newServices,
                                                        currentServices),
                                                        options),
                    serviceRelation.detach(_.difference(currentServices,
                                                        newServices),
                                                        options),
                    surchargeRelation.attach(_.difference(newSurcharges,
                                                          currentSurcharges),
                                                          options),
                    surchargeRelation.detach(_.difference(currentSurcharges,
                                                          newSurcharges),
                                                          options)
                  ).then(() => {
                    return resolve(newAppointment);
                  })
                });
            });
        })
      })
      .catch((err) => {
        return reject(err);
      });
    });
  },

  findAll: function(filter, options, transaction) {

    // merge filter an options with default
    filter = _.assign({}, filter);
    options = _.assign({}, options);

    if (!_.isEmpty(transaction)) {
      options.transacting = transaction;
    }

    return this.filterAppointments(filter, options)
      .fetchAll(options)
      .then((collection) => {
        if (collection) {
          return collection;
        }
        return null;
      });
  },

  /**
   * Appends additional KNEX query info to parent `filter()` method
   * in order to grab recurring events.
   */
  filterAppointments: function(filter, options) {

    // if startDate and endDate are passed as options, then return generated
    // instances of events (single and recurring).
    if (options.startDate !== undefined &&
      options.endDate !== undefined) {

      const startDate = options.startDate;
      const endDate = options.endDate;

      // remove startDate and endDate from filters
      delete options.startDate;
      delete options.endDate;

      return this
        .filter(filter, options)
        .query(function(qb) {
          return qb.from(Bookshelf.knex.raw('get_appointments(?, ?, ?) AS appointment', [filter.businessId, startDate, endDate]));
        });
    }

    // if startDate and endDate are NOT passed, then we retrieve the non-generated
    // instances of events (single and reccuring).
    return this.filter(filter, options);
  }

});

module.exports = Bookshelf.model('Appointment', Appointment);
