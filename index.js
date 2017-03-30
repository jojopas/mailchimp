var express = require('express');
var app = express();
var memoizer = require('lru-memoizer');
var Request = require('superagent');
var syncWithMailChimp = require('./scripts/syncWithMailChimp');
var metadata = require('./webtask.json');
var async = require('async');

function job (req, res) {

  var ctx = req.webtaskContext;

  var required_settings = [
    'DSP_COMPANY_ARRAY' // Array of company IDs, like so: ['abcdefg', 'hijklmnop', '123456']
  ],
  a,
  dsp_array,
  results = [],
  reqeusts = [],
  status = 200;

  // required_settings = [
  //   'AUTH0_DOMAIN',
  //   'AUTH0_CLIENT_ID',
  //   'AUTH0_CLIENT_SECRET',
  //   'MAILCHIMP_API_KEY',
  //   'MAILCHIMP_LIST_NAME',
  //   'AUTH0_CONNECTION_NAME'
  // ];

  var missing_settings = required_settings.filter(function (setting) {
    return !ctx.data[setting];
  });

  if (missing_settings.length) {
    return res.status(400).send({message: 'Missing settings: ' + missing_settings.join(', ')});
  }

  try{
    dsp_array = JSON.parse(ctx.data.DSP_COMPANY_ARRAY);
  } catch(e){
    return res.sendStatus(500).send('Error - could not parse the given string into an array for DSP_COMPANY_ARRAY');
  }

    getDspToken(function(err, resToken){

      if(err) return res.sendStatus(500).send("Error getting token: " + err);

      getDspSettings(resToken.token, dsp_array, function(err, resSettings){

        if(err) return res.sendStatus(500).send("Error getting DSP settings: " + err);

        for(a=0;a<resSettings.length;a++){

          var config = {
            TENANT_DOMAIN: resSettings[a].settings.AUTH0_DOMAIN,
            USER_SEARCH_MGMT_TOKEN: req.access_token,
            MAILCHIMP_API_KEY: resSettings[a].settings.MAILCHIMP_API_KEY,
            MAILCHIMP_LIST_NAME: resSettings[a].settings.MAILCHIMP_LIST_NAME,
            AUTH0_CONNECTION_NAME: resSettings[a].settings.AUTH0_CONNECTION_NAME,
          };

          requests.push(syncWithMailChimp(config));

        }

        async.waterfall(requests, function(err){
          if (err) {
            console.error(err);
            return res.sendStatus(500).send("Error processing MailChimp requests: " + err);
          }
          // All good
          return res.sendStatus(200).send("MailChimp syncronization successful!");
        });

      });
    });

}

function getDspToken(cb){
  Request
    .post("http://api.myspotlight.tv/token/company")
    .send({
      key: "5888cfa099f815bd28fb077d" // Automatic testing account
    })
    // .type('application/json')
    .end(function (err, res) {
      if (err || !res.ok) {
        return cb(err, null);
      } else {
        return cb(null, res.body);
      }
    });
}

function getDspSettings(token, companies, cb){
  Request
    .post("http://api.myspotlight.tv/companies/auth0mailchimp?token=" + token)
    .send({
      companies: JSON.stringify(companies)
    })
    // .type('application/json')
    .end(function (err, res) {
      if (err || !res.ok) {
        return cb(err, null);
      } else {
        return cb(null, res.body);
      }
    });
}

function requestMailChimpSync (config, cb) {
  syncWithMailChimp(config).then(function () {
    return cb();
  }, function (err) {
    return cb(err);
  } );
}

var getTokenCached = memoizer({
  load: function (apiUrl, audience, clientId, clientSecret, cb) {
    Request
      .post(apiUrl)
      .send({
        audience: audience,
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })
      .type('application/json')
      .end(function (err, res) {
        if (err || !res.ok) {
          cb(null, err);
        } else {
          cb(res.body.access_token);
        }
      });
  },
  hash: function (apiUrl) { return apiUrl },
  max: 100,
  maxAge: 1000 * 60 * 60
});

app.use(function (req, res, next) {
  // Exclude /meta from authz
  if (req.path === '/meta') {
    return next();
  }

  var apiUrl       = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
  var audience     = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';

  var clientId     = req.webtaskContext.data.AUTH0_CLIENT_ID;
  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
    if (err) {
      console.error('Error getting access_token', err);
      return next(err);
    }

    req.access_token = access_token;
    // console.log(req.access_token);
    next();
  });
});

app.get ('/', job);
app.post('/', job);

app.get('/meta', function (req, res) {
  res.status(200).send(metadata);
});

module.exports = app;
