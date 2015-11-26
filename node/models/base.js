const _ = require('lodash'),
  Bookshelf = require('../config/bookshelf'),
  Inflection = require('inflection'),
  Joi = require('joi'),
  Promise = require('bluebird');

let Base = Bookshelf.Model.extend({

  // Automatically add timestamps to models.
  hasTimestamps: ['createdAt', 'updatedAt'],

  /**
   * Sets the model to validate on save.
   */
  initialize: function() {
    this.on('saving', this.validate);
  },

  /**
   * Validates the model using a Joi schema (if present).
   * @return {[type]} [description]
   */
  validate: function() {
    if (this.schema) {
      return Promise.promisify(Joi.validate)(this.attributes, this.schema, {
        stripUnknown: true
      });
    }
  },

  /**
   * Converts snake_case attributes to camelCase.
   * @param  {[type]} attrs [description]
   * @return {[type]}       [description]
   */
  parse: function(attrs) {
    return _.reduce(attrs, function(memo, val, key) {
      memo[_.camelCase(key)] = val;
      return memo;
    }, {});
  },

  /**
   * Converts camelCase attributes to snake_case.
   * @param  {[type]} attrs [description]
   * @return {[type]}       [description]
   */
  format: function(attrs) {
    return _.reduce(attrs, function(memo, val, key) {
      memo[Inflection.underscore(key, false)] = val;
      return memo;
    }, {});
  }

}, {

  ///////////////////////////////////////
  // CRUD METHODS
  ///////////////////////////////////////

  /**
   * Naive add - create and save a model based on data
   * @param {Object} data
   * @param {Object} options (optional)
   * @return {Promise(bookshelf.Model)} single Model
   */
  create: function(data, options, transaction) {

    // set options
    options = _.assign({}, options);

    if (!_.isEmpty(transaction)) {
      options.transacting = transaction;
    }

    return this.forge(data)
      .save(null, options)
      .then((model) => {
        if (model) {
          return model;
        }
        return null;
      });
  },

  /**
   * Naive update - update a model based on data
   * @param {Object} data
   * @param {Object} options
   * @return {Promise(bookshelf.Model)} edited Model
   */
  update: function(data, filter, options, transaction) {

    // if there is no data, bail
    if (_.isEmpty(data)) {
      return Promise.reject(new Error('update requires a data payload.'));
    }

    // attempt to grab an id either from the payload or the filter
    const id = data.id || filter.id;

    // if no id is present, bail
    if (_.isUndefined(id)) {
      return Promise.reject(new Error('A record id is required as part of the data or filter.'));
    }

    // set criteria on which to filter
    filter = _.assign({
      id: id
    }, filter);

    // set options
    options = _.assign({
      patch: true,
      require: true,
      method: 'update'
    }, options);

    // if transaction exists, make update part of transaction
    if (!_.isEmpty(transaction)) {
      options.transacting = transaction;
    }

    return this
      .filter(filter, options)
      .save(data, options)
      .then((model) => {
        if (model) {
          // re-add the id of the record
          model.set('id', id);

          return model;
        }
        return null;
      });
  },

  /**
   * Convenience method to archive/delete a record.
   * @param  {[type]} id          [description]
   * @param  {[type]} options     [description]
   * @param  {[type]} transaction [description]
   * @return {[type]}             [description]
   */
  archive: function(filter, options, transaction) {

    if (!_.isUndefined(options) &&
      options.shouldDelete == true) {

      // delete the record if the shouldDelete option was passed and is true
      return this._destroy(filter, options, transaction);

    } else {

      // otherwise archive and deactivate the record
      return this.update({
        active: false,
        archived: true
      }, filter, options, transaction);

    }
  },

  /**
   * Naive destroy
   * @param {Object} options
   * @return {Promise(bookshelf.Model)} empty Model
   */
  _destroy: function(filter, options, transaction) {

    // ensure that an id is being passed, if not, bail
    if (_.isEmpty(filter) || _.isUndefined(filter.id)) {
      return Promise.reject(new Error('_destroy requires a record id'));
    }
    // set options
    options = _.assign({
      require: true
    }, options);

    // if the operation should be part of a transaction, make it happen
    if (!_.isEmpty(transaction)) {
      options.transacting = transaction;
    }

    return this
      .filter(filter)
      .destroy(options);
  },

  /**
   * Naive findOne - fetch data for `this` matching data
   * @param {Object} data
   * @param {Object} options (optional)
   * @return {Promise(bookshelf.Model)} single Model
   */
  findOne: function(filter, options, transaction) {

    // merge filter an options with default
    filter = _.assign({}, filter);
    options = _.assign({
      require: true
    }, options);

    if (!_.isEmpty(transaction)) {
      options.transacting = transaction;
    }

    return this.filter(filter, options)
      .fetch(options)
      .then((model) => {
        if (model) {
          return model;
        }
        return null;
      });
  },

  /**
   * Naive findAll - fetches all data for `this`
   * @param {Object} filter (optional)
   * @param {Object} options (optional)
   * @return {Promise(bookshelf.Collection)} Bookshelf Collection of Models
   */
  findAll: function(filter, options, transaction) {

    // merge filter an options with default
    filter = _.assign({}, filter);
    options = _.assign({}, options);

    if (!_.isEmpty(transaction)) {
      options.transacting = transaction;
    }

    let query;
    if (!_.isEmpty(filter)) {
      query = this.filter(filter, options);
    } else {
      query = this.forge();
    }

    return query
      .fetchAll(options)
      .then((collection) => {
        if (collection) {
          return collection;
        }
        return null;
      });
  },

  ///////////////////////////////////////
  // UTILITIES
  ///////////////////////////////////////

  /**
   * Wrapper for `where()` that automatically calls the `format()` function
   * to handle the conversion of column names between application and database.s
   * @param  {[type]} filter [description]
   * @return {[type]}        [description]
   */
  filter: function(filter, options) {

    if (!_.isEmpty(filter)) {

      const self = this;

      // call the format method that handles camelCase -> snake_case conversions
      filter = this.prototype.format(filter);

      return this.query(function(qb) {

        let query = qb.where(filter);

        // check for additional filters to be applied to the query
        if (options.additionalFilters) {

          let additionalFilters = self.prototype.format(options.additionalFilters);

          query = query.andWhere(function() {

            const self = this;

            _.forOwn(additionalFilters, function(v, k) {
              self.whereIn(k, v);
            });
          });
        }

        // check for pagination option
        if (options.pagination) {

          if (_.isNumber(options.pagination.offset)) {
            query = query.offset(options.pagination.offset);
          }

          if (_.isNumber(options.pagination.limit)) {
            query = query.limit(options.pagination.limit);
          }

        }

        if (options.sort) {

          _.forEach(options.sort, function(s) {

            // format the column name to snake_case
            s = Inflection.underscore(s);

            if (s.charAt(0) == '-') {
              // sort descending
              query = query.orderBy(s.slice(1, s.length), 'desc');
            } else {
              // sort ascending
              query = query.orderBy(s, 'asc');
            }
          })
        }

        return query;
      });
    }

    return this.query();
  }

});

module.exports = Bookshelf.model('Base', Base);
