const _ = require('lodash'),
  Appointment = require('../../models/appointment'),
  AppointmentPet = require('../../models/appointment_pet'),
  AppointmentService = require('../../models/appointment_service'),
  AppointmentSurcharge = require('../../models/appointment_surcharge'),
  Bookshelf = require('../../config/bookshelf'),
  Boom = require('boom'),
  parseParams = require('../../utils/json-api/parse-params'),
  Promise = require('bluebird'),
  Surcharge = require('../../models/surcharge'),
  JsonApiDataStore = require('jsonapi-datastore/').JsonApiDataStore;

module.exports = {

  /**
   * Creates a new appointment.
   * @param  {[type]} request Hapi request object
   * @param  {[type]} reply   Hapi reply object
   * @return {[type]}         [description]
   */
  create(request, reply) {

    let payload = request.store.find('appointment').serializeGeneric();

    // add the businessId of the authenticated user
    payload.attributes.businessId = request.auth.credentials.businessId;

    // appointments created by the business are always 'scheduled'
    // and will not enter the standard workflow
    payload.attributes.requestType = 'new';
    payload.attributes.requestStatus = 'approved';
    payload.attributes.status = 'scheduled';

    // strip the triggerNotification params from the payload
    const triggerCustomerNotification = payload.attributes.triggerCustomerNotification;
    const triggerStaffNotification = payload.attributes.triggerStaffNotification;

    delete payload.attributes.triggerCustomerNotification;
    delete payload.attributes.triggerStaffNotification;

    // create and return appointment
    Appointment
      .createAppointment(payload)
      .then((appointment) => {

        // trigger notifications
        if (!triggerCustomerNotification) {
          // TODO: trigger customer notification(s); this could be email and/or push
        }

        if (!triggerStaffNotification) {
          // TODO: trigger staff push notification
        }

        return reply.jsonapi(appointment, 'appointment').code(201);
      })
      .catch((err) => {
        return reply(err);
      });
    },

    /**
     * Fetches a single appointment by id.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    findOne(request, reply) {

      parseParams(request, 'appointment')
        .then((params) => {

          return Appointment
            .findOne({
              businessId: request.auth.credentials.businessId,
              id: request.params.appointmentId
            }, params.options)
            .then((response) => {
              return reply.jsonapi(response, 'appointment');
            })
            .catch((err) => {
              return reply(err);
            });

        });
    },

    /**
     * Retrieves a list of appointments.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    findAll(request, reply) {

      parseParams(request, 'appointment')
        .then((params) => {

          const filter = {
            businessId: request.auth.credentials.businessId,
          };

          // get the start and end date params
          const startDate = request.query.startDate,
            endDate = request.query.endDate;

          params.options = _.assign({
            startDate: startDate,
            endDate: endDate
          }, params.options);

          // only page if not paging by date range or paging
          // has been explicitly disabled
          if (!(startDate && endDate) &&
            !_.get(params, 'options.pagination.disabled')) {

            // set default paging options
            params.options.pagination = _.assign({
              offset: 0,
              limit: 25
            }, params.options.pagination);

          } else {
            // delete any pagination params that may have been passed
            delete params.options.pagination;
          }

          return Appointment
            .findAll(filter, params.options)
            .then((response) => {

              // pass in the original query parameters to be appended to
              // self and pagination links
              const options = _.assign(params.options, {
                query: request.query
              });

              return reply.jsonapi(response, 'appointment', options);
            });

        })
        .catch((err) => {
          return reply(err);
        });
    },

    /**
     * Updates a single appointment.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    update(request, reply) {

      const payload = request.store.find('appointment').serializeGeneric();
      const businessId = request.auth.credentials.businessId;

      const filter = {
        id: request.params.appointmentId,
        businessId: businessId
      };

      // add businessId to payload
      payload.attributes.businessId = businessId;

      // strip the triggerNotification params from the payload
      const triggerCustomerNotification = payload.attributes.triggerCustomerNotification;
      const triggerStaffNotification = payload.attributes.triggerStaffNotification;

      delete payload.attributes.triggerCustomerNotification;
      delete payload.attributes.triggerStaffNotification;

      // update appointment
      Appointment
        .updateAppointment(payload, filter)
        .then((response) => {

          if (triggerCustomerNotification) {
            // TODO: trigger customer notification(s); this could be email and/or push
          }

          if (triggerStaffNotification) {
            // TODO: trigger staff push notification
          }

          return reply.jsonapi(response, 'appointment');
        })
        .catch((err) => {
          return reply(err);
        });
    },

    /**
     * Archives an appointment.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    archive(request, reply) {

      let options = {};

      // check query params to see if this should be a delete operation
      if (request.query.shouldDelete) {
        options.shouldDelete = true;
      }

      const filter = {
        id: request.params.appointmentId,
        businessId: request.auth.credentials.businessId
      };

      Appointment.archive(filter, options)
        .then((response) => {
          if (options.shouldDelete) {
            return reply().code(204);
          }
          return reply(response);
        })
        .catch((err) => {
          return reply(err);
        });
    },

    /**
     * Approves an appointment request.
     * @param  {[type]} request [description]
     * @param  {[type]} reply   [description]
     * @return {[type]}         [description]
     */
    approve(request, reply) {

      const payload = {
        requestStatus: 'approved',
        updatedBy: 'business',
        status: 'scheduled'
      };

      const filter = {
        id: request.params.appointmentId,
        businessId: request.auth.credentials.businessId
      };

      // update the appointment to be "approved"
      Appointment.update(payload, filter)
        .then((response) => {

          // TODO: trigger a notification to the customer

          // TODO: trigger notification to the assigned staff member

          return reply(response);
        })
        .catch((err) => {
          return reply(err);
        });

    },


    /**
     * Denies an appointment request.
     * @param  {[type]} request [description]
     * @param  {[type]} reply   [description]
     * @return {[type]}         [description]
     */
    deny(request, reply) {

      const appointmentId = request.params.appointmentId,
        businessId = request.auth.credentials.businessId;

      // update the appointment to be "denied"
      Appointment.denyAppointment(businessId, appointmentId)
        .then((response) => {

          let message = request.payload.message;

          // TODO: trigger a notification to the customer

          // TODO: trigger notification to the assigned staff member

          return reply.jsonapi(response, 'appointment');
        })
        .catch((err) => {
          return reply(err);
        });

    },

    /**
     * Cancels an appointment.
     * @param  {[type]} request [description]
     * @param  {[type]} reply   [description]
     * @return {[type]}         [description]
     */
    cancel(request, reply) {

      const appointmentId = request.params.appointmentId,
        businessId = request.auth.credentials.businessId;

      Appointment
        .cancelAppointment(businessId, appointmentId, request.query.withPenalty)
        .then((response) => {

          // TODO: trigger a notification to the customer

          // TODO: trigger notification to the assigned staff member

          return reply.jsonapi(response, 'appointment');
        })
        .catch((err) => {
          return reply(err);
        });
    }

};
