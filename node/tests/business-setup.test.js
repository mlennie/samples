const Code = require('code');
const lab = require('lab');
const Lab = exports.lab = lab.script();
const server = require('../../server');
const bookshelf = require('../../config/bookshelf');
const helpers = require('../helpers');

// setup Lab to behave like BDD
const describe = Lab.describe;
const it = Lab.it;
const before = Lab.before;
const after = Lab.after;
const expect = Code.expect;

const _ = require('lodash'),
  factories = require('../factories');

describe('Business Setup', () => {
  let business = {};

  before((done) => {
    helpers.util.resetDatabase()
      .then(() => {
        helpers.util.registerBusiness(true)
          .then((response) => {
            business.businessInfo = response.business;
            business.user = response.user;
            business.staff = response.staff;
            business.businessPreferences = response.businessPreferences;
            done();
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  describe('when unauthenticated', () => {

    it('cannot access the endpoint', (done) => {
      const options = {
        method: 'PATCH',
        url: `/businesses/${business.businessInfo.get('id')}/setup`,
        payload: '',
      };

      server.inject(options, function(response) {
        expect(response.statusCode).to.equal(401);
        done();
      });
    });

  });

  describe('when authenticated', () => {
    let token;

    before((done) => {
      helpers.util.loginStaff(business.user.get('email'),
          business.businessInfo.get('id'))
        .then((response) => {
          token = response.token;
          done();
        });
    });

    describe('but unauthorized', () => {

      it('cannot access the endpoint', (done) => {

        const options = {
          method: 'PATCH',
          url: `/businesses/${business.businessInfo.get('id') + 1}/setup`,
          payload: '',
          headers: {
            Authorization: token
          }
        };

        server.inject(options, function(response) {
          expect(response.statusCode).to.equal(403);
          done();
        });
      });

    });

    it('can create business setup data', (done) => {

      factories.service().buildMany('service', {
        businessId: business.businessInfo.get('id')
      }, 3, (err, services) => {

        business.services = services;

        factories.surcharge().buildMany('surcharge', {
          businessId: business.businessInfo.get('id')
        }, 3, (err, surcharges) => {

          business.surcharges = surcharges;

          const payload = {
            business: business.businessInfo.toJSON(),
            businessPreference: business.businessPreferences.toJSON(),
            staff: business.staff.toJSON(),
            user: business.user.toJSON(),
            services: _.map(business.services, (s) => {
              return s.toJSON();
            }),
            surcharges: _.map(business.surcharges, (s) => {
              return s.toJSON();
            })
          };
          
          const options = {
            method: 'PATCH',
            url: `/businesses/${business.businessInfo.get('id')}/setup`,
            payload: payload,
            headers: {
              'Authorization': token
            }
          };

          server.inject(options, function(response) {
            expect(response.statusCode).to.equal(200);
            return done();
          });

        });

      });

    });

    it('verify that it was stored correctly', (done) => {
      helpers.util.getBusinessSetupData()
        .then((data) => {
          const a = data.user.models[0].attributes,
            b = business.user.attributes;
          expect(a).to.deep.equal(b);
          done();
        });
    });

  });

});
