'use strict';

var util = require('util'),
    Base = require('./base'),
    _ = require('lodash'),
    { Op } = require('sequelize'),
    utils = require('../utils'),
    errors = require('../Errors');

var List = function(args) {
  List.super_.call(this, args);
};

var LIKE_OPERATOR_DEFAULT = Op.like;

util.inherits(List, Base);

List.prototype.action = 'list';
List.prototype.method = 'get';
List.prototype.plurality = 'plural';

List.prototype._safeishParse = function(value, type, sequelize) {

  if (sequelize) {
    if (type instanceof sequelize.STRING || type instanceof sequelize.CHAR || type instanceof sequelize.TEXT) {
      if (!isNaN(value)) {
        return value;
      }
    } else if (type instanceof sequelize.INTEGER || type instanceof sequelize.BIGINT) {

    } else if (type instanceof sequelize.DATE) {
      return new Date(value);
    }
  }

  try {
    return JSON.parse(value);
  } catch(err) {
    return value;
  }
};

var stringOperators = /like|iLike|notLike|notILike/;

function isLikeOperator(searchOperator) {
  if ([Op.like, Op.iLike, Op.notLike, Op.notILike].includes(searchOperator)) {
    return true;
  }

  return typeof searchOperator === 'string' && stringOperators.test(searchOperator);
}

List.prototype.fetch = function(req, res, context) {
  var self = this,
      model = this.model,
      options = context.options || {},
      criteria = context.criteria || {},
      // function that can be passed to transform final options object
      transformOptions = context.transformOptions,
      include = this.include,
      includeAttributes = this.includeAttributes,
      Sequelize = this.resource.sequelize,
      defaultCount = 100,
      count = +context.count || +req.query.count || defaultCount,
      offset = +context.offset || +req.query.offset || 0;

  // only look up attributes we care about
  options.attributes = options.attributes || this.resource.attributes;

  // account for offset and count
  offset += context.page * count || req.query.page * count || 0;
  if (count < 0) count = defaultCount;

  options.offset = offset;
  options.limit = count;
  if (!this.resource.pagination)
    delete options.limit;

  if (context.include && context.include.length) {
    include = include.concat(context.include);
  }
  if (include.length) {
    options.include = include;
  }

  // Fixes the Content-Range header's count of items
  if(options.include)
    options.distinct = true;

  var searchParams = this.resource.search.length ? this.resource.search : [this.resource.search];
  searchParams.forEach(function(searchData) {
    var searchParam = searchData.param;
    if (_.has(req.query, searchParam)) {
      var search = [];
      var searchOperator = searchData.operator || LIKE_OPERATOR_DEFAULT;
      var searchAttributes =
        searchData.attributes || Object.keys(model.rawAttributes);
      searchAttributes.forEach(function(attr) {
        if(isLikeOperator(searchOperator)){
          var attrType = model.rawAttributes[attr].type;
          if (!(attrType instanceof Sequelize.STRING) &&
              !(attrType instanceof Sequelize.TEXT)) {
            // NOTE: Sequelize has added basic validation on types, so we can't get
            //       away with blind comparisons anymore. The feature is up for
            //       debate so this may be changed in the future
            return;
          }
        }

        var item = {};
        var query = {};
        var searchString;
        if (typeof searchOperator === 'symbol' ? searchOperator !== LIKE_OPERATOR_DEFAULT : !~searchOperator.toLowerCase().indexOf('like')) {
          searchString = req.query[searchParam];
        } else {
          searchString = '%' + req.query[searchParam] + '%';
        }
        query[searchOperator] = searchString;
        item[attr] = query;
        search.push(item);
      });

      if (utils.hasProperties(criteria))
        criteria = Sequelize.and(criteria, Sequelize.or.apply(null, search));
      else
        criteria = Sequelize.or.apply(null, search);
    }
  });

  var sortParam = this.resource.sort.param;
  if (_.has(req.query, sortParam) || _.has(this.resource.sort, 'default')) {
    var order = [];
    var columnNames = [];
    var sortQuery = req.query[sortParam] || this.resource.sort.default || '';
    var sortColumns = sortQuery.split(',');
    sortColumns.forEach(function(sortColumn) {
      if (sortColumn.indexOf('-') === 0) {
        var actualName = sortColumn.substring(1);
        order.push([actualName, 'DESC']);
        columnNames.push(actualName);
      } else {
        columnNames.push(sortColumn);
        order.push([sortColumn, 'ASC']);
      }
    });
    var allowedColumns = this.resource.sort.attributes || Object.keys(model.rawAttributes);
    var disallowedColumns = _.difference(columnNames, allowedColumns);
    if (disallowedColumns.length) {
      throw new errors.BadRequestError('Sorting not allowed on given attributes', disallowedColumns);
    }

    if (order.length)
      options.order = order;
  }

  // all other query parameters are passed to search
  var extraSearchCriteria = _.reduce(req.query, function(result, value, key) {
    if (_.has(model.rawAttributes, key)) result[key] = self._safeishParse(value, model.rawAttributes[key].type, Sequelize);
    return result;
  }, {});

  if (utils.hasProperties(extraSearchCriteria))
    criteria = _.assign(criteria, extraSearchCriteria);

  // do the actual lookup
  if (utils.hasProperties(criteria))
    options.where = criteria;

  if (req.query.scope) {
    model = model.scope(req.query.scope);
  }

  if (transformOptions) {
    transformOptions(options);
  }

  return model
    .findAndCountAll(options)
    .then(function(result) {
      context.instance = result.rows;
      var start = offset;
      var end = start + result.rows.length - 1;
      end = end === -1 ? 0 : end;

      if (self.resource.associationOptions.removeForeignKeys) {
        _.each(context.instance, function(instance) {
          _.each(includeAttributes, function(attr) {
            delete instance[attr];
            delete instance.dataValues[attr];
          });
        });
      }

      if (!!self.resource.pagination)
        res.header('Content-Range', 'items ' + [[start, end].join('-'), result.count].join('/'));

      return context.continue;
    });
};

module.exports = List;
