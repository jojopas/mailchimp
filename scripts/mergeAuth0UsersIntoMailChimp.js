'use strict';

var mergeAuth0UsersIntoMailChimp = function (config, mailchimp) {
  return function (context, callback) {
    // Upload users (add new or update existing ones)

    var listId = context.mailChimpList.id;
    var users = context.auth0Users;

    var userArrays = [];
    var errs = "";
    var done = [];

    users.map((val, i) => {
      const ind = (Math.floor(i/100));
      if(!userArrays[ind]) userArrays[ind] = [];
      userArrays[ind].push(val);
      console.log("User added to", ind);
    });

   userArrays.sort((a, b) => a - b);

    setTimeout(() => {
      userArrays.map((userVal, ii) => {
        setTimeout(() => {
          mailchimp.lists_batch_subscribe({
            id: listId,
            batch: userVal.map(function (user) {
              return {
                email: {
                  email: user.email
                },
                email_type: 'text',
                merge_vars: {
                  'FNAME': user.given_name || '',
                  'LNAME': user.family_name || ''
                }
              };
            }),
            double_optin: false,
            update_existing: true,
            replace_interests: false
          }, function (err, res) {
            done.push(ii);
            if (err && ii < (userArrays.length-1)) {
              errs += err + "\n";
              return console.error(ii, err);
            }
            console.log('Batch List update completed successfully for index', ii);
            // If we are done but have errors, return the errors.  If not, good to go.
            if (errs.length > 0 && done.length === userArrays.length) {
              console.error(errs);
              return callback(errs);
            } else if(done.length === userArrays.length){
              console.log('All batch list updates completed successfully');
              return callback(null, context);
            }
          });
        }, (ii * 500));

      });
      }, 1000);
    };
};

module.exports = mergeAuth0UsersIntoMailChimp;
