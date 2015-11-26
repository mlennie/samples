const _ = require('lodash'),
  Bookshelf = require('../../config/bookshelf'),
  moment = require('moment'),
  jwt = require('jsonwebtoken'),
  Boom = require('boom'),
  Business = require('../../models/business'),
  Staff = require('../../models/staff'),
  User = require('../../models/user'),
  Promise = require('bluebird'),
  config = require('config'),
  scopes = require('../../utils/auth/scopes'),
  swearjar = require('swearjar');

module.exports = {

    /**
     * Creates a new business.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    create(request, reply) {

      const newBusiness = {
        name: request.payload.businessName,
        subdomain: request.payload.subdomain
      };

      const newUser = {
        firstName: request.payload.firstName,
        lastName: request.payload.lastName,
        email: request.payload.email,
        password: request.payload.password
      };

      // checks for unique email and subdomain before creating
      Promise.join(
        Business.validateSubdomain(newBusiness.subdomain),
        User.validateEmail(newUser.email),
        (subdomainErr, emailErr) => {
          const errors = _.compact([subdomainErr, emailErr]);

          if (_.isEmpty(errors)) {

            Business.createBusiness(newBusiness, newUser).then((accountId) => {

              // generate an account verification token
              const jwtPayload = {
                exp: moment().add(process.env.ACCOUNT_VERIFICATION_TOKEN_EXPIRATION, 'days').unix(),
                accountId: accountId
              };

              // return the account verification token
              const token = jwt.sign(jwtPayload, process.env.ACCOUNT_VERIFICATION_SECRET);

              // TODO: send verification email with token

              return reply().code(201);
            });
          } else {
            return reply(Boom.badRequest(errors));
          }
        }).catch((err) => {
        return reply(err);
      });
    },

    /**
     * Fetches a single business by id.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    findOne(request, reply) {

      // setup relations to fetch
      const relations = [
        'businessPreference',
        'users',
        'services',
        'surcharges'
      ];

      const options = {
        withRelated: relations,
      };

      Business.findOne({id: request.auth.credentials.businessId }, options)
        .then((business) => {
          return reply.jsonapi(business, 'business');
        }).catch((err) => {
          return reply(err);
        });
    },

    /**
     * Fetches a single business by its subdomain.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    findBySubdomain(request, reply) {

      // columns to return
      const options = {
        columns: ['id', 'name']
      };

      Business.findOne({
          subdomain: request.params.subdomain
        }, options)
        .then((business) => {
          return reply(business);
        }).catch((err) => {
          return reply(err);
        });
    },

    /**
     * Updates a single business.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    update(request, reply) {

      let business = request.payload;
      business.id = request.auth.credentials.businessId;

      Business
        .update(business)
        .then(() => {
          return reply();
        })
        .catch((err) => {
          return reply(err);
        });
    },

    /**
     * Archives a business.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    archive(request, reply) {

      let options = {};

      if (!_.isUndefined(request.query) &&
        request.query.shouldDelete === true) {
        options.shouldDelete = true;
      };

      Business
        .archive(request.params.businessId, options)
        .then(() => {
          return reply();
        })
        .catch((err) => {
          return reply(err);
        });
    },

    /**
     * Updates multiple business attributes for the business setup process.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    setup(request, reply) {

      // add the business id to each object in the payload
      _.forEach(request.payload, (obj, key) => {
        if (key == 'business') {
          return _.assign(obj, { id: request.auth.credentials.businessId });
        } else {
          return _.assign(obj, { businessId: request.auth.credentials.businessId });
        }
      });

      Business
        .setup(request.payload.business,
          request.payload.staff,
          request.payload.businessPreference,
          request.payload.services,
          request.payload.surcharges)
        .then(() => {
          return reply();
        })
        .catch((err) => {
          return reply(err);
        });
    },

    /**
     * Validates whether or not the specified subdomain is available for use.
     * @param  {[type]} request Hapi request object
     * @param  {[type]} reply   Hapi reply object
     * @return {[type]}         [description]
     */
    validateSubdomain(request, reply) {

      Business
        .validateSubdomain(request.params.subdomain)
        .then((msg) => {
          if (msg) {
            return reply(Boom.badRequest(msg));
          }
          return reply();
        }).catch((err) => {
          return reply(err);
        });
    }
};
