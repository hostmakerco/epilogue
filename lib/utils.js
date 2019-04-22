'use strict';

module.exports = {
  hasProperties(criteria) {
    return Object.keys(criteria).length || Object.getOwnPropertySymbols(criteria).length;
  }
};
