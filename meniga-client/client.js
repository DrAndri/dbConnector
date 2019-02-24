var men = require('./index.js');
var moment = require("moment");
console.log("LOL");
var meniga = new men();
meniga.auth('andrithorhalls@gmail.com', 'Superman12');
setTimeout(function () {
  console.log(meniga.getTransactionsPage({
  	page: 1,
  	transactionsPerPage: 10,
	  	filter: {subProperties: {
	    PeriodFrom: moment('2015-01-01'),
	    PeriodTo: moment('2016-02-01')
	}
  }}));
}, 3000)