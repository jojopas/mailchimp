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
    'AUTH0_DOMAIN',
    'AUTH0_CLIENT_ID',
    'AUTH0_CLIENT_SECRET',
    'AUTH0_CONNECTION_NAME',
    'DSP_COMPANY_ARRAY' // Array of company IDs, like so: ['abcdefg', 'hijklmnop', '123456']
  ],
  a,
  dsp_array,
  results = [],
  requests = [],
  status = 200;



  var missing_settings = required_settings.filter(function (setting) {
    return !ctx.data[setting];
  });

  if (missing_settings.length) {
    return res.status(400).send({message: 'Missing settings: ' + missing_settings.join(', ')});
  }

    dsp_array = ctx.data.DSP_COMPANY_ARRAY;

    getDspToken(function(err, resToken){

      if(err) return res.status(500).send("Error getting token: " + err);

      getDspSettings(resToken.token, dsp_array, function(err, resSettings){

        if(err || !resSettings.success) return res.status(500).send("Error getting DSP settings: " + (err || resSettings.error));

        var settings = resSettings.settings;

        for(a=0;a<settings.length;a++){

          if(!settings[a].auth0_config.mailchimp_api_key || !settings[a].auth0_config.mailchimp_list_name){
            console.log("Missing params for " + settings[a]._id);
            continue;
          }

          var config = {
            TENANT_DOMAIN: req.webtaskContext.data.AUTH0_DOMAIN,
            USER_SEARCH_MGMT_TOKEN: req.access_token,
            MAILCHIMP_API_KEY: settings[a].auth0_config.mailchimp_api_key,
            MAILCHIMP_LIST_NAME: settings[a].auth0_config.mailchimp_list_name,
            AUTH0_COMPANY: settings[a]._id,
          };

          requests.push(syncWithMailChimp(config));

        }

        // async.waterfall(requests, function(err){
        //   if (err) {
        //     console.error(err);
        //     return res.status(500).send("Error processing MailChimp requests: " + err);
        //   }
        //   // All good
        //   return res.status(200).send("MailChimp syncronization successful!");
        // });

        var errs = "";

        requests.map((val, i) => {
          val.then(() => {
            console.log("Yep: ", i);
            if(i === (requests.length-1)) return res.status(errs.length > 0 ? 500 : 200).send(errs.length > 0 ? errs : "Lookin' Good!");
          }, (err) => {
            errs += err + "\n";
            if(i === (requests.length-1)) return res.status(500).send(errs);
          });
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
  if(!token || !companies) return cb("Missing params in getDspSettings", null);
  Request
    .post("http://api.myspotlight.tv/companies/auth0mailchimp?token=" + token)
    .send({
      companyIds: companies
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
